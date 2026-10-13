import { ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { PreviewLimits, RemoteSearchRequest, SaveProfileInput, ServerProfile, TrustHostKeyInput } from '@shared/types'
import {
  connectProfile,
  copyRemotePath,
  createRemoteDirectory,
  deleteRemoteEntry,
  listDirectory,
  stopSession,
} from './connections'
import {
  endpointKey,
  profileFromState,
  readPreviewLimits,
  readState,
  writePreviewLimits,
  writeState,
} from './state-store'
import { cancelTransfer, downloadEntry, uploadSelection, withTransferLock } from './transfers'
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
    stopSession(id)
    return savedProfile
  })

  ipcMain.handle('profiles:delete', (_event, profileId: string) => {
    stopSession(profileId)
    const state = readState()
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    delete state.passwords[profileId]
    writeState(state)
  })

  ipcMain.handle('connection:connect', (_event, profileId: string) => connectProfile(profileId))
  ipcMain.handle('connection:disconnect', (_event, profileId: string) => stopSession(profileId))
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

  ipcMain.handle('files:list', (_event, profileId: string, remotePath: string) =>
    listDirectory(profileId, remotePath))
  ipcMain.handle('files:search', (_event, request: RemoteSearchRequest) => startRemoteSearch(request))
  ipcMain.handle('files:search-cancel', (_event, requestId: string) => cancelRemoteSearch(requestId))
  ipcMain.handle('files:upload-files', (event, requestId: string, profileId: string, remoteDirectory: string) =>
    withTransferLock(profileId, requestId, (signal) => uploadSelection(event, requestId, profileId, remoteDirectory, false, signal)))
  ipcMain.handle('files:upload-folder', (event, requestId: string, profileId: string, remoteDirectory: string) =>
    withTransferLock(profileId, requestId, (signal) => uploadSelection(event, requestId, profileId, remoteDirectory, true, signal)))
  ipcMain.handle('files:download', (event, requestId: string, profileId: string, remotePath: string) =>
    withTransferLock(profileId, requestId, (signal) => downloadEntry(event, requestId, profileId, remotePath, signal)))
  ipcMain.handle('files:transfer-cancel', (_event, requestId: string) => cancelTransfer(requestId))
  ipcMain.handle('files:create-directory', (_event, profileId: string, remoteDirectory: string, name: string) =>
    createRemoteDirectory(profileId, remoteDirectory, name))
  ipcMain.handle('files:path-copy', (_event, profileId: string, remotePath: string) => copyRemotePath(profileId, remotePath))
  ipcMain.handle('files:delete', (_event, profileId: string, remotePath: string) => deleteRemoteEntry(profileId, remotePath))
  ipcMain.handle('files:preview', (_event, profileId: string, remotePath: string) => previewFile(profileId, remotePath))
  ipcMain.handle('files:preview-log', (_event, profileId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(profileId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
