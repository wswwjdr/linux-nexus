import { clipboard } from 'electron'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { Client } from 'ssh2'
import type { ConnectResult, RemoteEntry, SessionKind } from '@shared/types'
import { cancelSearchesForSession, failSearchesForSession } from './search'
import { cancelTransfersForSession } from './transfers'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { endpointKey, passwordFor, profileFromState, readState } from './state-store'
import { clearPreviewAssetsForSession } from './previews'
import {
  executeRemoteCommand,
  fileType,
  normalizedRemotePath,
  shellQuote,
  sftpLstat,
  sftpMkdir,
} from './sftp-utils'

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
  failSearchesForSession(activeSession.sessionId, message)
  cancelTransfersForSession(activeSession.sessionId)
  clearPreviewAssetsForSession(activeSession.sessionId)
  sendConnectionClosed(activeSession.sessionId, activeSession.profileId, message)
}

export function stopSession(sessionId: string): void {
  pendingConnections.get(sessionId)?.cancel()
  cancelSearchesForSession(sessionId)
  const transfers = cancelTransfersForSession(sessionId)
  clearPreviewAssetsForSession(sessionId)
  const activeSession = sessions.get(sessionId)
  if (!activeSession) return
  sessions.delete(sessionId)
  if (transfers.length === 0) {
    activeSession.client.end()
  } else {
    void Promise.all(transfers.map((transfer) => transfer.settled)).then(() => activeSession.client.end())
  }
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
      const activate = (sftp?: ActiveSession['sftp'], shell?: ActiveSession['shell']) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: '连接已取消' })
          return
        }
        const activeSession: ActiveSession = { sessionId, client, kind, profileId, sftp, shell }
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
          if (startPath) shell.write('cd -- ' + shellQuote(normalizedRemotePath(startPath)) + '\n')
        }
        finish({ ok: true, path: kind === 'sftp' ? '/' : startPath })
      }

      if (kind === 'sftp') {
        client.sftp((error, sftp) => {
          if (error) {
            finish({ ok: false, reason: 'sftp-unavailable', message: error.message })
            return
          }
          activate(sftp)
        })
      } else {
        client.shell({ term: 'xterm-256color', cols, rows }, (error, shell) => {
          if (error) {
            finish({ ok: false, reason: 'other', message: error.message })
            return
          }
          activate(undefined, shell)
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

function getSftpSession(sessionId: string): ActiveSession & { sftp: NonNullable<ActiveSession['sftp']> } {
  const activeSession = sessions.get(sessionId)
  if (!activeSession?.sftp) throw new Error('SFTP 会话未连接')
  return activeSession as ActiveSession & { sftp: NonNullable<ActiveSession['sftp']> }
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
  const activeSession = getSftpSession(sessionId)
  const normalizedPath = posix.resolve('/', remotePath || '/')

  return new Promise((resolve, reject) => {
    activeSession.sftp.readdir(normalizedPath, (error, entries) => {
      if (error) {
        reject(new Error(error.message))
        return
      }
      const result = entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry): RemoteEntry => {
          const mode = entry.attrs.mode ?? 0
          const kind = mode & 0o170000
          const type: RemoteEntry['type'] = kind === 0o040000
            ? 'directory'
            : kind === 0o100000
              ? 'file'
              : kind === 0o120000
                ? 'symlink'
                : 'other'
          return {
            name: entry.filename,
            path: posix.join(normalizedPath, entry.filename),
            type,
            size: entry.attrs.size ?? 0,
            modifiedAt: entry.attrs.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : null,
            permissions: (mode & 0o777).toString(8).padStart(3, '0'),
          }
        })
        .sort((left, right) => {
          if (left.type === 'directory' && right.type !== 'directory') return -1
          if (left.type !== 'directory' && right.type === 'directory') return 1
          return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
        })
      resolve(result)
    })
  })
}

export function copyRemotePath(sessionId: string, remotePath: string): void {
  getSftpSession(sessionId)
  clipboard.writeText(normalizedRemotePath(remotePath))
}

export async function createRemoteDirectory(
  sessionId: string,
  remoteDirectory: string,
  name: string,
): Promise<void> {
  const activeSession = getSftpSession(sessionId)
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new Error('名称无效：不能包含路径分隔符，也不能是 . 或 ..')
  }
  const parentPath = normalizedRemotePath(remoteDirectory)
  if (fileType((await sftpLstat(activeSession.sftp, parentPath)).mode) !== 'directory') {
    throw new Error('当前路径不是文件夹')
  }
  const targetPath = posix.join(parentPath, name)
  await sftpMkdir(activeSession.sftp, targetPath)
}

export async function deleteRemoteEntry(sessionId: string, remotePath: string): Promise<void> {
  const activeSession = getSftpSession(sessionId)
  const normalizedPath = normalizedRemotePath(remotePath)
  if (normalizedPath === '/') throw new Error('不能删除服务器根目录')
  const attributes = await sftpLstat(activeSession.sftp, normalizedPath)
  const type = fileType(attributes.mode)
  if (type !== 'file' && type !== 'directory') {
    throw new Error('只能删除普通文件或文件夹')
  }
  await executeRemoteCommand(activeSession.client, 'rm -rf -- ' + shellQuote(normalizedPath))
}

