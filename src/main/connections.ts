import { clipboard } from 'electron'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { Client } from 'ssh2'
import type { ConnectResult, RemoteEntry, SessionKind } from '@shared/types'
import { shellQuote } from '@shared/shell'
import { cancelNameSearchesForSession, failNameSearchesForSession } from './name-search'
import { cancelContentSearchesForSession, failContentSearchesForSession } from './content-search'
import { cancelScriptExecutionsForSession, failScriptExecutionsForSession } from './script-execution-runtime'
import { cancelTransfersForSession } from './transfers'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { endpointKey, passwordFor, profileFromState, readState } from './state-store'
import { clearPreviewAssetsForSession } from './previews'
import { cancelRemoteOperationsForSession } from './remote-operations'
import { removePerformanceMonitorForSession } from './performance-monitor'
import { runRemoteCommand } from './ssh-commands'
import { listRemoteDirectory } from './remote-fs'

const pendingConnections = new Map<string, { profileId: string; client: Client; cancel: () => void }>()
const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 3

function sendConnectionClosed(sessionId: string, profileId: string, message: string): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('connection:closed', { sessionId, profileId, message })
  }
}

function failActiveSession(activeSession: ActiveSession, message: string): void {
  if (sessions.get(activeSession.sessionId) !== activeSession) return
  sessions.delete(activeSession.sessionId)
  removePerformanceMonitorForSession(activeSession.sessionId)
  void cancelRemoteOperationsForSession(activeSession.sessionId)
  failScriptExecutionsForSession(activeSession.sessionId, message)
  failNameSearchesForSession(activeSession.sessionId, message)
  failContentSearchesForSession(activeSession.sessionId, message)
  cancelTransfersForSession(activeSession.sessionId)
  clearPreviewAssetsForSession(activeSession.sessionId)
  sendConnectionClosed(activeSession.sessionId, activeSession.profileId, message)
}

export function stopSession(sessionId: string): void {
  removePerformanceMonitorForSession(sessionId)
  pendingConnections.get(sessionId)?.cancel()
  cancelNameSearchesForSession(sessionId)
  cancelContentSearchesForSession(sessionId)
  cancelScriptExecutionsForSession(sessionId)
  const remoteOperations = cancelRemoteOperationsForSession(sessionId)
  const transfers = cancelTransfersForSession(sessionId)
  clearPreviewAssetsForSession(sessionId)
  const activeSession = sessions.get(sessionId)
  if (!activeSession) return
  sessions.delete(sessionId)
  void Promise.all([remoteOperations, ...transfers.map((transfer) => transfer.settled)])
    .then(() => activeSession.client.end())
}

export function stopSessionsForProfile(profileId: string): void {
  for (const [sessionId, pending] of pendingConnections) {
    if (pending.profileId !== profileId) continue
    stopSession(sessionId)
    sendConnectionClosed(sessionId, profileId, '服务器配置已更新')
  }
  for (const activeSession of sessions.values()) {
    if (activeSession.profileId !== profileId) continue
    stopSession(activeSession.sessionId)
    sendConnectionClosed(activeSession.sessionId, profileId, '服务器配置已更新')
  }
}

export function stopAllSessions(): void {
  for (const sessionId of pendingConnections.keys()) stopSession(sessionId)
  for (const sessionId of sessions.keys()) stopSession(sessionId)
}

export function connectProfile(
  sessionId: string,
  profileId: string,
  kind: SessionKind,
  cols: number,
  rows: number,
  startPath: string,
): Promise<ConnectResult> {
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    let keyIssue: ConnectResult | null = null
    const isCurrentAttempt = () => pendingConnections.get(sessionId)?.client === client

    const finish = (result: ConnectResult) => {
      if (settled) return
      settled = true
      if (pendingConnections.get(sessionId)?.client === client) pendingConnections.delete(sessionId)
      if (!result.ok) client.end()
      resolve(result)
    }

    pendingConnections.set(sessionId, {
      profileId,
      client,
      cancel: () => finish({ ok: false, reason: 'other', message: '连接已取消' }),
    })

    client.on('ready', () => {
      if (!isCurrentAttempt()) {
        finish({ ok: false, reason: 'other', message: '连接已取消' })
        return
      }
      const activate = (shell?: ActiveSession['shell']) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: '连接已取消' })
          return
        }
        const activeSession: ActiveSession = { sessionId, client, kind, profileId, shell }
        sessions.set(sessionId, activeSession)
        if (shell) {
          const stdoutDecoder = new StringDecoder('utf8')
          const stderrDecoder = new StringDecoder('utf8')
          const sendOutput = (data: string) => {
            if (!data) return
            const window = getMainWindow()
            if (window && !window.isDestroyed()) {
              window.webContents.send('terminal:output', { sessionId, data })
            }
          }
          shell.on('data', (chunk: Buffer) => sendOutput(stdoutDecoder.write(chunk)))
          shell.stderr.on('data', (chunk: Buffer) => sendOutput(stderrDecoder.write(chunk)))
          shell.on('close', () => {
            sendOutput(stdoutDecoder.end())
            sendOutput(stderrDecoder.end())
            if (sessions.get(sessionId) === activeSession) {
              failActiveSession(activeSession, 'SSH 终端已退出')
              client.end()
            }
          })
          shell.on('error', (shellError: Error) => failActiveSession(activeSession, shellError.message))
          if (startPath) shell.write('cd -- ' + shellQuote(posix.resolve('/', startPath)) + '\n')
        }
        finish({ ok: true, path: kind === 'files' ? '/' : startPath })
      }

      if (kind === 'files') {
        void verifyFileSessionCapabilities(client).then(
          () => activate(),
          (error: unknown) => finish({ ok: false, reason: 'other', message: error instanceof Error ? error.message : String(error) }),
        )
      } else {
        client.shell({ term: 'xterm-256color', cols, rows }, (error, shell) => {
          if (error) {
            finish({ ok: false, reason: 'other', message: error.message })
            return
          }
          activate(shell)
        })
      }
    })

    client.on('error', (error: Error & { level?: string }) => {
      const activeSession = sessions.get(sessionId)
      if (activeSession?.client === client) {
        failActiveSession(
          activeSession,
          error.message === 'Keepalive timeout'
            ? 'SSH 保活超时，服务器或网络已断开'
            : error.message || 'SSH 连接异常',
        )
        client.destroy()
        return
      }
      if (!isCurrentAttempt() || settled) return
      if (keyIssue) {
        finish(keyIssue)
        return
      }
      const message = error.message || '连接失败'
      const lowerMessage = message.toLowerCase()
      if (error.level === 'client-authentication' || lowerMessage.includes('authentication')) {
        finish({ ok: false, reason: 'auth-failed', message: '用户名或密码错误，或服务器拒绝了密码认证' })
      } else if (/timed out|econnrefused|ehostunreach|enetunreach|enotfound|socket hang up/i.test(message)) {
        finish({ ok: false, reason: 'unreachable', message: '无法连接服务器，请检查地址、端口和网络或 VPN' })
      } else {
        finish({ ok: false, reason: 'other', message })
      }
    })

    client.on('close', () => {
      const activeSession = sessions.get(sessionId)
      if (activeSession?.client === client) failActiveSession(activeSession, 'SSH 连接已关闭')
      if (!settled && isCurrentAttempt()) {
        finish({ ok: false, reason: 'unreachable', message: '连接在完成前关闭' })
      }
    })

    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password,
      readyTimeout: 15000,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      hostVerifier: (hash: Buffer, callback: (verified: boolean) => void) => {
        if (!isCurrentAttempt()) {
          callback(false)
          return
        }
        const fingerprint = 'SHA256:' + createHash('sha256').update(hash).digest('base64').replace(/=+$/, '')
        const previousFingerprint = readState().hostKeys[endpointKey(profile)]
        if (previousFingerprint === fingerprint) {
          callback(true)
          return
        }
        keyIssue = previousFingerprint
          ? { ok: false, reason: 'host-key-changed', fingerprint, previousFingerprint }
          : { ok: false, reason: 'host-key-unknown', fingerprint }
        callback(false)
      },
    })
  })
}

function getFilesSession(sessionId: string): ActiveSession {
  const activeSession = sessions.get(sessionId)
  if (!activeSession || activeSession.kind !== 'files') throw new Error('文件会话未连接')
  return activeSession
}

export function writeTerminal(sessionId: string, data: string): void {
  const shell = sessions.get(sessionId)?.shell
  if (!shell || shell.destroyed) throw new Error('SSH 终端未连接')
  shell.write(data)
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  const shell = sessions.get(sessionId)?.shell
  if (!shell || shell.destroyed) throw new Error('SSH 终端未连接')
  shell.setWindow(rows, cols, 0, 0)
}

export function listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]> {
  const activeSession = getFilesSession(sessionId)
  return listRemoteDirectory(activeSession.client, remotePath)
}

export function copyRemotePath(sessionId: string, remotePath: string): void {
  getFilesSession(sessionId)
  clipboard.writeText(posix.resolve('/', remotePath))
}

export async function createRemoteDirectory(
  sessionId: string,
  remoteDirectory: string,
  name: string,
): Promise<void> {
  const activeSession = getFilesSession(sessionId)
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error('名称无效：不能包含路径分隔符，也不能是 . 或 ..')
  }
  const parentPath = posix.resolve('/', remoteDirectory)
  const targetPath = posix.join(parentPath, name)
  await runRemoteCommand(activeSession.client, 'mkdir -- "$1"', [targetPath])
}

export async function deleteRemoteEntries(sessionId: string, remotePaths: string[]): Promise<void> {
  const activeSession = getFilesSession(sessionId)
  if (!Array.isArray(remotePaths) || remotePaths.length === 0) throw new Error('至少选择一个远程项目')
  const paths = remotePaths.map((remotePath) => {
    if (typeof remotePath !== 'string' || !remotePath || remotePath.includes('\0')) throw new Error('删除路径无效')
    return posix.resolve('/', remotePath)
  })
  if (paths.includes('/')) throw new Error('不能删除服务器根目录')
  if (new Set(paths).size !== paths.length) throw new Error('删除列表包含重复路径')
  await runRemoteCommand(activeSession.client,
    'set -eu; for path in "$@"; do [[ ! -L "$path" && ( -f "$path" || -d "$path" ) ]] || { printf "只能删除普通文件或文件夹: %s\\n" "$path" >&2; exit 1; }; done; rm -r -- "$@"',
    paths,
  )
}

async function verifyFileSessionCapabilities(client: Client): Promise<void> {
  const script = [
    'set -eu',
    'for tool in bash cp mv rm mkdir find grep tar sha256sum dd tail mktemp stat; do',
    '  command -v "$tool" >/dev/null || { printf "缺少服务器命令: %s\\n" "$tool" >&2; exit 1; }',
    'done',
    'find --version | grep -q "GNU find" || { printf "%s\\n" "需要 GNU findutils" >&2; exit 1; }',
    'cp --version | grep -q "GNU coreutils" || { printf "%s\\n" "需要 GNU coreutils" >&2; exit 1; }',
    '. /etc/os-release',
    'case "$ID:$VERSION_ID" in',
    '  ubuntu:*|debian:*|centos:8*|centos:9*|centos:10*|rhel:8*|rhel:9*|rhel:10*) ;;',
    '  *) printf "不支持的服务器发行版: %s %s\\n" "$ID" "$VERSION_ID" >&2; exit 1 ;;',
    'esac',
  ].join('\n')
  await runRemoteCommand(client, script)
}

