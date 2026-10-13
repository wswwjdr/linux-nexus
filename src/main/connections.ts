import { clipboard } from 'electron'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { Client } from 'ssh2'
import type { ConnectResult, RemoteEntry } from '@shared/types'
import { cancelSearchesForProfile, failSearchesForProfile } from './search'
import { cancelTransfersForProfile } from './transfers'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { endpointKey, passwordFor, profileFromState, readState } from './state-store'
import {
  executeRemoteCommand,
  fileType,
  normalizedRemotePath,
  shellQuote,
  sftpLstat,
  sftpMkdir,
} from './sftp-utils'

let pendingConnection: { profileId: string; client: Client; generation: number; cancel: () => void } | null = null
let connectionGeneration = 0

function sendConnectionClosed(profileId: string, message: string): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('connection:closed', { profileId, message })
  }
}

export function stopSession(profileId: string): void {
  if (pendingConnection?.profileId === profileId) pendingConnection.cancel()
  cancelSearchesForProfile(profileId)
  const transfers = cancelTransfersForProfile(profileId)
  const activeSession = sessions.get(profileId)
  if (!activeSession) return
  sessions.delete(profileId)
  if (transfers.length === 0) {
    activeSession.client.end()
  } else {
    void Promise.all(transfers.map((transfer) => transfer.settled)).then(() => activeSession.client.end())
  }
}

export function stopAllSessions(): void {
  pendingConnection?.cancel()
  for (const profileId of sessions.keys()) stopSession(profileId)
}

export function connectProfile(profileId: string): Promise<ConnectResult> {
  stopAllSessions()
  const generation = ++connectionGeneration
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    let keyIssue: ConnectResult | null = null
    const isCurrentAttempt = () => connectionGeneration === generation
      && pendingConnection?.client === client
      && pendingConnection.generation === generation

    const finish = (result: ConnectResult) => {
      if (settled) return
      settled = true
      if (pendingConnection?.client === client) pendingConnection = null
      if (!result.ok) client.end()
      resolve(result)
    }

    pendingConnection = {
      profileId,
      client,
      generation,
      cancel: () => finish({ ok: false, reason: 'other', message: '连接已取消' }),
    }

    client.on('ready', () => {
      if (!isCurrentAttempt()) {
        finish({ ok: false, reason: 'other', message: '连接已取消' })
        return
      }
      client.sftp((error, sftp) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: '连接已取消' })
          return
        }
        if (error) {
          finish({ ok: false, reason: 'sftp-unavailable', message: error.message })
          return
        }
        const activeSession: ActiveSession = { client, sftp, profileId }
        sessions.set(profileId, activeSession)
        finish({ ok: true, path: '/' })
      })
    })

    client.on('error', (error: Error & { level?: string }) => {
      if (sessions.get(profileId)?.client === client) {
        cancelTransfersForProfile(profileId)
        failSearchesForProfile(profileId, error.message)
        sessions.delete(profileId)
        sendConnectionClosed(profileId, error.message)
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
      if (sessions.get(profileId)?.client === client) {
        cancelTransfersForProfile(profileId)
        failSearchesForProfile(profileId, 'SSH 连接已关闭')
        sessions.delete(profileId)
        sendConnectionClosed(profileId, 'SSH 连接已关闭')
      }
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
      hostVerifier: (hash, callback) => {
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

export function listDirectory(profileId: string, remotePath: string): Promise<RemoteEntry[]> {
  const activeSession = sessions.get(profileId)
  if (!activeSession) throw new Error('服务器未连接')
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

export function copyRemotePath(profileId: string, remotePath: string): void {
  if (!sessions.has(profileId)) throw new Error('服务器未连接')
  clipboard.writeText(normalizedRemotePath(remotePath))
}

export async function createRemoteDirectory(
  profileId: string,
  remoteDirectory: string,
  name: string,
): Promise<void> {
  const activeSession = sessions.get(profileId)
  if (!activeSession) throw new Error('服务器未连接')
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

export async function deleteRemoteEntry(profileId: string, remotePath: string): Promise<void> {
  const activeSession = sessions.get(profileId)
  if (!activeSession) throw new Error('服务器未连接')
  const normalizedPath = normalizedRemotePath(remotePath)
  if (normalizedPath === '/') throw new Error('不能删除服务器根目录')
  const attributes = await sftpLstat(activeSession.sftp, normalizedPath)
  const type = fileType(attributes.mode)
  if (type !== 'file' && type !== 'directory') {
    throw new Error('只能删除普通文件或文件夹')
  }
  await executeRemoteCommand(activeSession.client, 'rm -rf -- ' + shellQuote(normalizedPath))
}

