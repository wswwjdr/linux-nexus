import { createHash, randomUUID } from 'node:crypto'
import { Client } from 'ssh2'
import type {
  CommandAlias,
  CommandAliasPreflight,
  CommandAliasOperationResult,
  CommandAliasSnapshot,
  ServerProfile,
} from '@shared/types'
import { formatBashAliasDefinition, parseCommandAliasProtocol, validateCommandAlias } from '@shared/command-aliases'
import { endpointKey, passwordFor, profileFromState, readState, writeState } from './state-store'
import { messageFromError } from './runtime'
import { shellQuote } from '@shared/shell'
import { buildRemoteCommand, executeRemoteCommand, runRemoteCommand } from './ssh-commands'

const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 3
const COMMAND_TIMEOUT_MS = 30_000
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
const operationLocks = new Map<string, Promise<void>>()
const aliasPreflights = new Map<string, StoredAliasPreflight>()
const ALIAS_PREFLIGHT_TTL_MS = 10 * 60_000

interface StoredAliasPreflight extends CommandAliasPreflight {
  expectedRevision: string
  expectedDefinition: string
  replacementDefinition: string
  expiresAt: number
  running: boolean
}

interface HostKeyRequired {
  status: 'host-key-required'
  fingerprint: string
  previousFingerprint?: string
}

function resultFromHostKey(result: HostKeyRequired): CommandAliasOperationResult {
  return result.previousFingerprint
    ? { status: result.status, fingerprint: result.fingerprint, previousFingerprint: result.previousFingerprint }
    : { status: result.status, fingerprint: result.fingerprint }
}

async function withProfileLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  const previous = operationLocks.get(profileId) ?? Promise.resolve()
  let release = () => {}
  const current = new Promise<void>((resolve) => { release = resolve })
  operationLocks.set(profileId, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (operationLocks.get(profileId) === current) operationLocks.delete(profileId)
  }
}

function classifyConnectionError(error: Error & { level?: string }): Error {
  const message = error.message || '连接失败'
  const lowerMessage = message.toLowerCase()
  if (error.level === 'client-authentication' || lowerMessage.includes('authentication')) {
    return new Error('用户名或密码错误，或服务器拒绝了密码认证')
  }
  if (/timed out|econnrefused|ehostunreach|enetunreach|enotfound|socket hang up/i.test(message)) {
    return new Error('无法连接服务器，请检查地址、端口和网络或 VPN')
  }
  return new Error(message)
}

function withTemporaryConnection<T>(profileId: string, operation: (client: Client, profile: ServerProfile) => Promise<T>): Promise<T | HostKeyRequired> {
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve, reject) => {
    const client = new Client()
    let settled = false
    let operationStarted = false
    let keyIssue: HostKeyRequired | null = null
    const cleanup = () => {
      client.removeListener('ready', onReady)
      client.removeListener('error', onError)
      client.removeListener('close', onClose)
    }
    const finish = (result?: T | HostKeyRequired, error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(result as T | HostKeyRequired)
    }
    const onReady = () => {
      if (operationStarted || settled) return
      operationStarted = true
      void operation(client, profile)
        .then((result) => finish(result))
        .catch((error: unknown) => finish(undefined, error instanceof Error ? error : new Error(String(error))))
        .finally(() => client.end())
    }
    const onError = (error: Error & { level?: string }) => {
      if (keyIssue) {
        finish(keyIssue)
        client.destroy()
      }
      else if (!operationStarted) finish(undefined, classifyConnectionError(error))
    }
    const onClose = () => {
      if (settled || operationStarted) return
      if (keyIssue) finish(keyIssue)
      else finish(undefined, new Error('连接在完成前关闭'))
    }

    client.once('ready', onReady)
    client.on('error', onError)
    client.once('close', onClose)
    try {
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password,
        readyTimeout: 15_000,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        hostVerifier: (hash: Buffer, callback: (verified: boolean) => void) => {
          const fingerprint = 'SHA256:' + createHash('sha256').update(hash).digest('base64').replace(/=+$/, '')
          const previousFingerprint = readState().hostKeys[endpointKey(profile)]
          if (previousFingerprint === fingerprint) {
            callback(true)
            return
          }
          keyIssue = previousFingerprint
            ? { status: 'host-key-required', fingerprint, previousFingerprint }
            : { status: 'host-key-required', fingerprint }
          callback(false)
        },
      })
    } catch (error) {
      finish(undefined, error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function assertBashLoginShell(client: Client): Promise<void> {
  const { stdout } = await runRemoteCommand(client, 'getent passwd "$(id -un)" | cut -d: -f7', [], { timeoutMs: COMMAND_TIMEOUT_MS })
  const loginShell = stdout.toString('utf8').trim().split(/\r?\n/).at(-1)
  if (!loginShell || loginShell.split('/').at(-1) !== 'bash') {
    throw new Error('该服务器的登录 Shell 不是 Bash，命令别名功能暂不支持')
  }
}

async function readRemoteAliases(client: Client): Promise<CommandAlias[]> {
  const nonce = randomUUID().replace(/-/g, '')
  const beginMarker = `__LINUX_NEXUS_ALIASES_BEGIN_${nonce}__`
  const endMarker = `__LINUX_NEXUS_ALIASES_END_${nonce}__`
  const script = [
    `printf '%s\\0' ${shellQuote(beginMarker)}`,
    'for alias_name in "${!BASH_ALIASES[@]}"; do',
    '  alias_command=${BASH_ALIASES[$alias_name]}',
    '  alias_definition=$(alias "$alias_name")',
    '  removable=0',
    '  alias_file=$HOME/.bashrc',
    '  if [[ -f $alias_file && ! -L $alias_file ]]; then',
    '    exact_count=0',
    '    while IFS= read -r alias_line || [[ -n $alias_line ]]; do',
    '      if [[ $alias_line == "$alias_definition" ]]; then exact_count=$((exact_count + 1)); fi',
    '    done < "$alias_file"',
    '    if [[ $exact_count -eq 1 ]]; then removable=1; fi',
    '  fi',
    `  printf '%s\\0%s\\0%s\\0%s\\0' "$alias_name" "$alias_command" "$alias_definition" "$removable"`,
    'done',
    `printf '%s\\0' ${shellQuote(endMarker)}`,
  ].join('\n')
  const { stdout: output } = await executeRemoteCommand(client, `bash -ic ${shellQuote(script)}`, {
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxStdoutBytes: MAX_COMMAND_OUTPUT_BYTES,
  })
  return parseCommandAliasProtocol(output, beginMarker, endMarker).map(({ definition, ...alias }) => {
    let removable = alias.removable
    let removalReason = removable ? '此别名不是应用支持的标准单行定义' : '未在 ~/.bashrc 中找到唯一且完全匹配的单行定义'
    if (removable) {
      try {
        removable = formatBashAliasDefinition(alias.name, alias.command) === definition
      } catch {
        removable = false
      }
      if (removable) removalReason = ''
    }
    return {
      ...alias,
      removable,
      removalReason: removable ? null : removalReason,
    }
  })
}

const modifyBashrcScript = `set -euo pipefail
mode=$1
expected=$2
replacement=$3
expected_revision=$4
alias_name=$5
alias_file=$HOME/.bashrc
if [[ -L $alias_file ]]; then printf '%s\\n' '拒绝修改符号链接 ~/.bashrc' >&2; exit 41; fi
if [[ -e $alias_file && ! -f $alias_file ]]; then printf '%s\\n' '~/.bashrc 不是普通文件' >&2; exit 41; fi
if [[ $expected_revision == missing ]]; then
  [[ ! -e $alias_file && ! -L $alias_file ]] || { printf '%s\\n' '~/.bashrc 已变化，请重新预检' >&2; exit 43; }
else
  [[ -f $alias_file && ! -L $alias_file ]] || { printf '%s\\n' '~/.bashrc 已变化，请重新预检' >&2; exit 43; }
  actual_revision=$(sha256sum < "$alias_file" | cut -d ' ' -f1)
  [[ $actual_revision == "$expected_revision" ]] || { printf '%s\\n' '~/.bashrc 已变化，请重新预检' >&2; exit 43; }
fi
exact_count=0
if [[ $mode != append && -f $alias_file ]]; then
  while IFS= read -r alias_line || [[ -n $alias_line ]]; do
    if [[ $alias_line == "$expected" ]]; then exact_count=$((exact_count + 1)); fi
  done < "$alias_file"
fi
if [[ $mode == append && -f $alias_file ]]; then
  alias_prefix="alias $alias_name="
  while IFS= read -r alias_line || [[ -n $alias_line ]]; do
    [[ $alias_line != "$alias_prefix"* ]] || { printf '%s\\n' '服务器上已存在同名 alias，请重新同步' >&2; exit 44; }
  done < "$alias_file"
fi
if [[ $mode != append && $exact_count -ne 1 ]]; then
  printf '%s\\n' '只找到零处或多处完全匹配的 alias 定义，服务器文件未修改' >&2
  exit 42
fi
temporary_file=$(mktemp "\${HOME}/.bashrc.linux-nexus.XXXXXX")
trap 'rm -f -- "$temporary_file"' EXIT
if [[ -f $alias_file ]]; then chmod --reference="$alias_file" "$temporary_file"; else chmod 600 "$temporary_file"; fi
if [[ -f $alias_file ]]; then
  while IFS= read -r alias_line || [[ -n $alias_line ]]; do
    if [[ $mode != append && $alias_line == "$expected" ]]; then
      if [[ $mode == replace ]]; then printf '%s\\n' "$replacement"; fi
    else
      printf '%s\\n' "$alias_line"
    fi
  done < "$alias_file" > "$temporary_file"
fi
if [[ $mode == append ]]; then printf '%s\\n' "$replacement" >> "$temporary_file"; fi
mv -- "$temporary_file" "$alias_file"
trap - EXIT`

function modifyBashrcCommand(
  mode: 'append' | 'replace' | 'delete',
  expected: string,
  replacement: string,
  expectedRevision: string,
  aliasName: string,
): string {
  return buildRemoteCommand(modifyBashrcScript, [mode, expected, replacement, expectedRevision, aliasName])
}

async function modifyBashrc(
  client: Client,
  mode: 'append' | 'replace' | 'delete',
  expected: string,
  replacement: string,
  expectedRevision: string,
  aliasName: string,
): Promise<void> {
  await executeRemoteCommand(client, modifyBashrcCommand(mode, expected, replacement, expectedRevision, aliasName), {
    timeoutMs: COMMAND_TIMEOUT_MS,
  })
}

async function bashrcRevision(client: Client): Promise<string> {
  const { stdout } = await runRemoteCommand(client, [
    'set -eu',
    'alias_file=$HOME/.bashrc',
    '[[ ! -L $alias_file ]] || { printf "%s\\n" "拒绝读取符号链接 ~/.bashrc" >&2; exit 41; }',
    'if [[ -e $alias_file && ! -f $alias_file ]]; then printf "%s\\n" "~/.bashrc 不是普通文件" >&2; exit 41; fi',
    'if [[ -f $alias_file ]]; then sha256sum < "$alias_file" | cut -d " " -f1; else printf missing; fi',
  ].join('\n'))
  const revision = stdout.toString('ascii').trim()
  if (revision !== 'missing' && !/^[a-f0-9]{64}$/.test(revision)) throw new Error('服务器返回的 ~/.bashrc 版本无效')
  return revision
}

function snapshotFromState(profileId: string): CommandAliasSnapshot {
  const existing = readState().commandAliases[profileId]
  return existing ?? { profileId, aliases: [], syncedAt: null, status: 'unsynced' }
}

function saveSnapshot(profileId: string, aliases: CommandAlias[], status: CommandAliasSnapshot['status'], syncedAt: string | null): CommandAliasSnapshot {
  const state = readState()
  profileFromState(state, profileId)
  const snapshot: CommandAliasSnapshot = { profileId, aliases, syncedAt, status }
  state.commandAliases[profileId] = snapshot
  writeState(state)
  return snapshot
}

function markSnapshotStale(profileId: string): CommandAliasSnapshot {
  const previous = snapshotFromState(profileId)
  return saveSnapshot(profileId, previous.aliases, 'stale', previous.syncedAt)
}

async function synchronizeConnectedProfile(client: Client, profileId: string): Promise<CommandAliasSnapshot> {
  await assertBashLoginShell(client)
  const aliases = await readRemoteAliases(client)
  return saveSnapshot(profileId, aliases, 'synced', new Date().toISOString())
}

async function withAliasOperation(
  profileId: string,
  operation: (client: Client) => Promise<CommandAliasOperationResult>,
): Promise<CommandAliasOperationResult> {
  return withProfileLock(profileId, async () => {
    const result = await withTemporaryConnection(profileId, async (client) => operation(client))
    return 'status' in result && result.status === 'host-key-required' ? resultFromHostKey(result) : result
  })
}

export function listCommandAliasSnapshots(): CommandAliasSnapshot[] {
  return Object.values(readState().commandAliases)
}

export function synchronizeCommandAliases(profileId: string): Promise<CommandAliasOperationResult> {
  if (typeof profileId !== 'string' || !profileId) throw new Error('服务器配置无效')
  return withAliasOperation(profileId, async (client) => ({
    status: 'completed',
    snapshot: await synchronizeConnectedProfile(client, profileId),
  }))
}

function pruneAliasPreflights(): void {
  const now = Date.now()
  for (const [id, preflight] of aliasPreflights) {
    if (preflight.expiresAt <= now) aliasPreflights.delete(id)
  }
}

function storeAliasPreflight(
  profileId: string,
  operation: CommandAliasPreflight['operation'],
  name: string,
  existingCommand: string,
  command: string | undefined,
  revision: string,
): CommandAliasOperationResult {
  const expectedDefinition = formatBashAliasDefinition(name, existingCommand)
  const replacementDefinition = command === undefined ? '' : formatBashAliasDefinition(name, command)
  const mode = operation === 'overwrite' ? 'replace' : 'delete'
  const preflight: StoredAliasPreflight = {
    preflightId: randomUUID(),
    profileId,
    operation,
    name,
    existingCommand,
    ...(command === undefined ? {} : { command }),
    commandPreview: modifyBashrcCommand(mode, expectedDefinition, replacementDefinition, revision, name),
    expectedRevision: revision,
    expectedDefinition,
    replacementDefinition,
    expiresAt: Date.now() + ALIAS_PREFLIGHT_TTL_MS,
    running: false,
  }
  aliasPreflights.set(preflight.preflightId, preflight)
  const { expectedRevision: _revision, expectedDefinition: _expected, replacementDefinition: _replacement, expiresAt: _expiresAt, running: _running, ...publicPreflight } = preflight
  return { status: 'confirmation-required', preflight: publicPreflight }
}

async function finishAliasModification(client: Client, profileId: string): Promise<CommandAliasOperationResult> {
  try {
    const aliases = await readRemoteAliases(client)
    const snapshot = saveSnapshot(profileId, aliases, 'synced', new Date().toISOString())
    return { status: 'completed', snapshot }
  } catch (error) {
    const snapshot = markSnapshotStale(profileId)
    return { status: 'updated-sync-failed', message: messageFromError(error), snapshot }
  }
}

export function saveCommandAlias(profileId: string, name: string, command: string): Promise<CommandAliasOperationResult> {
  if (typeof profileId !== 'string' || !profileId || typeof name !== 'string' || typeof command !== 'string') {
    throw new Error('命令别名参数无效')
  }
  validateCommandAlias(name, command)
  const replacement = formatBashAliasDefinition(name, command)

  return withAliasOperation(profileId, async (client) => {
    await assertBashLoginShell(client)
    const currentAliases = await readRemoteAliases(client)
    const existing = currentAliases.find((alias) => alias.name === name)
    const revision = await bashrcRevision(client)
    if (existing) {
      if (!existing.removable) throw new Error(existing.removalReason ?? '此别名无法安全覆盖')
      return storeAliasPreflight(profileId, 'overwrite', name, existing.command, command, revision)
    }
    await modifyBashrc(client, 'append', '', replacement, revision, name)
    return finishAliasModification(client, profileId)
  })
}

export function preflightDeleteCommandAlias(
  profileId: string,
  name: string,
  expectedCommand: string,
): Promise<CommandAliasOperationResult> {
  if (typeof profileId !== 'string' || !profileId || typeof name !== 'string' || !name
    || typeof expectedCommand !== 'string') throw new Error('命令别名参数无效')
  return withAliasOperation(profileId, async (client) => {
    await assertBashLoginShell(client)
    const currentAliases = await readRemoteAliases(client)
    const existing = currentAliases.find((alias) => alias.name === name)
    if (!existing || existing.command !== expectedCommand) throw new Error('服务器上的别名已变化，请先重新同步')
    if (!existing.removable) throw new Error(existing.removalReason ?? '此别名无法安全删除')
    return storeAliasPreflight(profileId, 'delete', name, existing.command, undefined, await bashrcRevision(client))
  })
}

export function executeCommandAliasOperation(preflightId: string): Promise<CommandAliasOperationResult> {
  if (typeof preflightId !== 'string' || !preflightId) throw new Error('命令别名预检编号无效')
  pruneAliasPreflights()
  const preflight = aliasPreflights.get(preflightId)
  if (!preflight) throw new Error('命令别名预检已过期，请重新操作')
  if (preflight.running) throw new Error('命令别名操作正在执行')
  preflight.running = true
  return withAliasOperation(preflight.profileId, async (client) => {
    const mode = preflight.operation === 'overwrite' ? 'replace' : 'delete'
    await modifyBashrc(client, mode, preflight.expectedDefinition, preflight.replacementDefinition,
      preflight.expectedRevision, preflight.name)
    return finishAliasModification(client, preflight.profileId)
  }).then((result) => {
    if (result.status === 'host-key-required') preflight.running = false
    else aliasPreflights.delete(preflightId)
    return result
  }, (error: unknown) => {
    aliasPreflights.delete(preflightId)
    throw error
  })
}

export function cancelCommandAliasPreflight(preflightId: string): boolean {
  if (typeof preflightId !== 'string' || !preflightId) throw new Error('命令别名预检编号无效')
  if (aliasPreflights.get(preflightId)?.running) return false
  return aliasPreflights.delete(preflightId)
}
