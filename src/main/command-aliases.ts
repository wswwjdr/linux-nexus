import { createHash, randomUUID } from 'node:crypto'
import { Client, type ClientChannel } from 'ssh2'
import type {
  CommandAlias,
  CommandAliasOperationResult,
  CommandAliasSnapshot,
  ServerProfile,
} from '@shared/types'
import { formatBashAliasDefinition, parseCommandAliasProtocol, validateCommandAlias } from '@shared/command-aliases'
import { endpointKey, passwordFor, profileFromState, readState, writeState } from './state-store'
import { messageFromError } from './runtime'
import { shellQuote } from './sftp-utils'

const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 3
const COMMAND_TIMEOUT_MS = 30_000
const MAX_COMMAND_OUTPUT_BYTES = 4 * 1024 * 1024
const operationLocks = new Map<string, Promise<void>>()

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

function executeRemoteCommand(client: Client, command: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | null = null
    let exitCode: number | null = null
    let settled = false
    let outputBytes = 0
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const timer = setTimeout(() => finish(new Error('服务器命令执行超时')), COMMAND_TIMEOUT_MS)
    const cleanup = () => {
      clearTimeout(timer)
      stream?.removeListener('data', onStdoutData)
      stream?.stderr.removeListener('data', onStderrData)
      stream?.removeListener('error', onStreamError)
      stream?.removeListener('exit', onExit)
      stream?.removeListener('close', onClose)
    }
    const finish = (error?: Error, code?: number | null) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      const finalCode = exitCode ?? code ?? null
      if (finalCode !== 0) {
        reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `远程命令失败（退出码 ${finalCode ?? '未知'}）`))
        return
      }
      resolve(Buffer.concat(stdout))
    }
    const onStdoutData = (chunk: Buffer) => {
      outputBytes += chunk.length
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        stream?.destroy()
        finish(new Error('服务器返回的命令别名数据过大'))
        return
      }
      stdout.push(Buffer.from(chunk))
    }
    const onStderrData = (chunk: Buffer) => stderr.push(Buffer.from(chunk))
    const onStreamError = (error: Error) => finish(error)
    const onExit = (code: number | null) => { exitCode = code }
    const onClose = (code: number | null) => finish(undefined, code)

    try {
      client.exec(command, (error, commandStream) => {
        if (error) {
          finish(error)
          return
        }
        stream = commandStream
        if (settled) {
          stream.destroy()
          return
        }
        stream.on('data', onStdoutData)
        stream.stderr.on('data', onStderrData)
        stream.once('error', onStreamError)
        stream.once('exit', onExit)
        stream.once('close', onClose)
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

async function assertBashLoginShell(client: Client): Promise<void> {
  const output = await executeRemoteCommand(client, 'getent passwd "$(id -un)" | cut -d: -f7')
  const loginShell = output.toString('utf8').trim().split(/\r?\n/).at(-1)
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
  const output = await executeRemoteCommand(client, `bash -ic ${shellQuote(script)}`)
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
alias_file=$HOME/.bashrc
if [[ -L $alias_file ]]; then printf '%s\\n' '拒绝修改符号链接 ~/.bashrc' >&2; exit 41; fi
if [[ -e $alias_file && ! -f $alias_file ]]; then printf '%s\\n' '~/.bashrc 不是普通文件' >&2; exit 41; fi
exact_count=0
if [[ $mode != append && -f $alias_file ]]; then
  while IFS= read -r alias_line || [[ -n $alias_line ]]; do
    if [[ $alias_line == "$expected" ]]; then exact_count=$((exact_count + 1)); fi
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

async function modifyBashrc(client: Client, mode: 'append' | 'replace' | 'delete', expected: string, replacement = ''): Promise<void> {
  const command = `bash -c ${shellQuote(modifyBashrcScript)} -- ${shellQuote(mode)} ${shellQuote(expected)} ${shellQuote(replacement)}`
  await executeRemoteCommand(client, command)
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

export function saveCommandAlias(profileId: string, name: string, command: string, overwrite: boolean): Promise<CommandAliasOperationResult> {
  if (typeof profileId !== 'string' || !profileId || typeof name !== 'string' || typeof command !== 'string' || typeof overwrite !== 'boolean') {
    throw new Error('命令别名参数无效')
  }
  validateCommandAlias(name, command)
  const replacement = formatBashAliasDefinition(name, command)

  return withAliasOperation(profileId, async (client) => {
    await assertBashLoginShell(client)
    const currentAliases = await readRemoteAliases(client)
    const existing = currentAliases.find((alias) => alias.name === name)
    if (existing && !overwrite) return { status: 'conflict', name, existingCommand: existing.command }
    const expected = existing ? formatBashAliasDefinition(name, existing.command) : ''
    await modifyBashrc(client, existing ? 'replace' : 'append', expected, replacement)
    try {
      const aliases = await readRemoteAliases(client)
      const snapshot = saveSnapshot(profileId, aliases, 'synced', new Date().toISOString())
      return { status: 'completed', snapshot }
    } catch (error) {
      const snapshot = markSnapshotStale(profileId)
      return { status: 'updated-sync-failed', message: messageFromError(error), snapshot }
    }
  })
}

export function deleteCommandAlias(profileId: string, name: string): Promise<CommandAliasOperationResult> {
  if (typeof profileId !== 'string' || !profileId || typeof name !== 'string' || !name) throw new Error('命令别名参数无效')
  const cachedAlias = snapshotFromState(profileId).aliases.find((alias) => alias.name === name)
  if (!cachedAlias) throw new Error('本地没有此别名，请先重新同步')
  if (!cachedAlias.removable) throw new Error(cachedAlias.removalReason ?? '此别名无法安全删除')

  return withAliasOperation(profileId, async (client) => {
    await assertBashLoginShell(client)
    const currentAliases = await readRemoteAliases(client)
    const existing = currentAliases.find((alias) => alias.name === name)
    if (!existing || existing.command !== cachedAlias.command) throw new Error('服务器上的别名已变化，请先重新同步')
    const expected = formatBashAliasDefinition(name, existing.command)
    await modifyBashrc(client, 'delete', expected)
    try {
      const aliases = await readRemoteAliases(client)
      const snapshot = saveSnapshot(profileId, aliases, 'synced', new Date().toISOString())
      return { status: 'completed', snapshot }
    } catch (error) {
      const snapshot = markSnapshotStale(profileId)
      return { status: 'updated-sync-failed', message: messageFromError(error), snapshot }
    }
  })
}
