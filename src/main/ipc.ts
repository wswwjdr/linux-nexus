import { ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PreviewLimits, RemoteSearchRequest, SaveProfileInput, ServerProfile, SessionKind, TrustHostKeyInput } from '@shared/types'
import {
  connectProfile,
  copyRemotePath,
  createRemoteDirectory,
  deleteRemoteEntry,
  listDirectory,
  resizeTerminal,
  stopSession,
  stopSessionsForProfile,
  writeTerminal,
} from './connections'
import { sessions } from './runtime'
import {
  endpointKey,
  profileFromState,
  readPreviewLimits,
  readState,
  writePreviewLimits,
  writeState,
} from './state-store'
import { cancelTransfer, downloadEntry, uploadDroppedEntries, uploadSelection, withTransferLock } from './transfers'
import { previewFile, readLogPreview, releasePreview } from './previews'
import { cancelRemoteSearch, startRemoteSearch } from './search'

export function registerIpc(): void {
  ipcMain.handle('profiles:list', () => readState().profiles)
  ipcMain.handle('profiles:save', async (_event, input: SaveProfileInput) => {
    const { profile, password } = input
    if (
      typeof profile?.id !== 'string' ||
      typeof profile?.name !== 'string' ||
      typeof profile.host !== 'string' ||
      typeof profile.username !== 'string'
    ) {
      throw new Error('服务器配置格式无效，请重新填写连接信息')
    }
    if (!profile.name.trim() || !profile.host.trim() || !profile.username.trim()) {
      throw new Error('名称、主机地址和用户名不能为空')
    }
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
      throw new Error('SSH 端口必须是 1 到 65535 之间的整数')
    }
    if (password !== undefined && typeof password !== 'string') {
      throw new Error('SSH 密码格式无效')
    }
    if (password && !safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 凭据加密不可用，不能安全保存密码')
    }

    const state = readState()
    const id = profile.id || randomUUID()
    const savedProfile: ServerProfile = {
      id,
      name: profile.name.trim(),
      host: profile.host.trim(),
      port: profile.port,
      username: profile.username.trim(),
    }
    const existingIndex = state.profiles.findIndex((candidate) => candidate.id === id)
    if (!password && !state.passwords[id]) throw new Error('请填写 SSH 密码')
    if (existingIndex === -1) state.profiles.push(savedProfile)
    else state.profiles[existingIndex] = savedProfile
    if (password) state.passwords[id] = safeStorage.encryptString(password).toString('base64')
    writeState(state)
    stopSessionsForProfile(id)
    return savedProfile
  })

  ipcMain.handle('profiles:delete', (_event, profileId: string) => {
    stopSessionsForProfile(profileId)
    const state = readState()
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    delete state.passwords[profileId]
    writeState(state)
  })

  ipcMain.handle('connection:connect', (_event, sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof profileId !== 'string' || !profileId
      || (kind !== 'sftp' && kind !== 'terminal')
      || !Number.isInteger(cols) || cols < 1 || cols > 500
      || !Number.isInteger(rows) || rows < 1 || rows > 200
      || typeof startPath !== 'string') {
      throw new Error('会话连接参数无效')
    }
    if (sessions.has(sessionId)) throw new Error('会话编号已在使用')
    return connectProfile(sessionId, profileId, kind, cols, rows, startPath)
  })
  ipcMain.handle('connection:disconnect', (_event, sessionId: string) => stopSession(sessionId))
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    if (typeof data !== 'string' || data.length > 65536) throw new Error('终端输入无效')
    writeTerminal(sessionId, data)
  })
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) {
      throw new Error('终端尺寸无效')
    }
    resizeTerminal(sessionId, cols, rows)
  })
  ipcMain.handle('settings:preview-limits:get', () => readPreviewLimits())
  ipcMain.handle('settings:preview-limits:save', (_event, limits: PreviewLimits) => writePreviewLimits(limits))
  ipcMain.handle('host-key:trust', (_event, input: TrustHostKeyInput) => {
    if (typeof input?.profileId !== 'string' || !input.profileId
      || typeof input.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint)
      || (input.previousFingerprint !== undefined
        && (typeof input.previousFingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.previousFingerprint)))) {
      throw new Error('服务器指纹格式无效')
    }
    const state = readState()
    const profile = profileFromState(state, input.profileId)
    const key = endpointKey(profile)
    const currentFingerprint = state.hostKeys[key]
    if (input.previousFingerprint && currentFingerprint !== input.previousFingerprint) {
      throw new Error('主机指纹已再次变化，请重新连接并核对')
    }
    if (!input.previousFingerprint && currentFingerprint && currentFingerprint !== input.fingerprint) {
      throw new Error('已有受信任的主机指纹，请重新连接并核对')
    }
    state.hostKeys[key] = input.fingerprint
    writeState(state)
  })

  ipcMain.handle('files:list', (_event, sessionId: string, remotePath: string) =>
    listDirectory(sessionId, remotePath))
  ipcMain.handle('files:search', (_event, request: RemoteSearchRequest) => startRemoteSearch(request))
  ipcMain.handle('files:search-cancel', (_event, requestId: string) => cancelRemoteSearch(requestId))
  const transferSession = (sessionId: string) => {
    const session = sessions.get(sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    return session
  }
  ipcMain.handle('files:upload-files', (event, requestId: string, sessionId: string, remoteDirectory: string) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => uploadSelection(event, requestId, sessionId, profileId, remoteDirectory, false, signal))
  })
  ipcMain.handle('files:upload-folder', (event, requestId: string, sessionId: string, remoteDirectory: string) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => uploadSelection(event, requestId, sessionId, profileId, remoteDirectory, true, signal))
  })
  ipcMain.handle('files:upload-dropped', (event, requestId: string, sessionId: string, remoteDirectory: string, entries: unknown) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => uploadDroppedEntries(event, requestId, sessionId, profileId, remoteDirectory, entries, signal))
  })
  ipcMain.handle('files:download', (event, requestId: string, sessionId: string, remotePath: string) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => downloadEntry(event, requestId, sessionId, profileId, remotePath, signal))
  })
  ipcMain.handle('files:transfer-cancel', (_event, requestId: string) => cancelTransfer(requestId))
  ipcMain.handle('files:create-directory', (_event, sessionId: string, remoteDirectory: string, name: string) =>
    createRemoteDirectory(sessionId, remoteDirectory, name))
  ipcMain.handle('files:path-copy', (_event, sessionId: string, remotePath: string) => copyRemotePath(sessionId, remotePath))
  ipcMain.handle('files:delete', (_event, sessionId: string, remotePath: string) => deleteRemoteEntry(sessionId, remotePath))
  ipcMain.handle('files:preview', (_event, sessionId: string, remotePath: string) => previewFile(sessionId, remotePath))
  ipcMain.handle('files:preview-log', (_event, sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(sessionId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
