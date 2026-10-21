import { ipcMain, safeStorage, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  AppSettings,
  RemoteCopyDecision,
  RemoteCopyRequest,
  RemoteMoveDecision,
  RemoteMoveRequest,
  RemoteSearchRequest,
  SaveProfileInput,
  ServerProfile,
  SessionKind,
  TrustHostKeyInput,
} from '@shared/types'
import { connectionIdentityChanged } from '@shared/command-aliases'
import { validateExternalUrl } from '@shared/external-url'
import { deleteCommandAlias, listCommandAliasSnapshots, saveCommandAlias, synchronizeCommandAliases } from './command-aliases'
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
  readAppSettings,
  readState,
  validateAppSettings,
  writeAppSettings,
  writeState,
} from './state-store'
import { cancelTransfer, downloadEntries, uploadDroppedEntries, uploadSelection, validateDownloadPaths, withTransferLock } from './transfers'
import { previewFile, readLogPreview, releasePreview, saveTextFile } from './previews'
import { cancelRemoteSearch, startRemoteSearch } from './search'
import { cancelRemoteMove, startRemoteMove } from './remote-moves'
import { executeRemoteCopy } from './remote-copies'

const pendingMoveDecisions = new Map<string, {
  conflictId: string
  senderId: number
  resolve: (decision: RemoteMoveDecision) => void
}>()
const activeMoveOwners = new Map<string, number>()
const pendingCopyDecisions = new Map<string, {
  conflictId: string
  senderId: number
  resolve: (decision: RemoteCopyDecision) => void
}>()
const activeCopyOwners = new Map<string, number>()

function parseRemoteMoveRequest(value: unknown): RemoteMoveRequest {
  if (!value || typeof value !== 'object') throw new Error('移动请求无效')
  const request = value as Partial<RemoteMoveRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.targetDirectory !== 'string'
    || !Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0
    || request.sourcePaths.some((path) => typeof path !== 'string')) {
    throw new Error('移动请求参数无效')
  }
  return request as RemoteMoveRequest
}

function parseRemoteCopyRequest(value: unknown): RemoteCopyRequest {
  if (!value || typeof value !== 'object') throw new Error('复制请求无效')
  const request = value as Partial<RemoteCopyRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.targetDirectory !== 'string'
    || !Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0
    || request.sourcePaths.some((path) => typeof path !== 'string')) {
    throw new Error('复制请求参数无效')
  }
  return request as RemoteCopyRequest
}

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
    const previousProfile = state.profiles[existingIndex]
    if (!password && !state.passwords[id]) throw new Error('请填写 SSH 密码')
    if (existingIndex === -1) state.profiles.push(savedProfile)
    else {
      state.profiles[existingIndex] = savedProfile
      if (connectionIdentityChanged(previousProfile, savedProfile)) {
        delete state.commandAliases[id]
      }
    }
    if (password) state.passwords[id] = safeStorage.encryptString(password).toString('base64')
    writeState(state)
    stopSessionsForProfile(id)
    return savedProfile
  })

  ipcMain.handle('profiles:delete', (_event, profileId: string) => {
    stopSessionsForProfile(profileId)
    const state = readState()
    const settings = readAppSettings()
    if (settings.startupConnection?.profileId === profileId) {
      writeAppSettings({ ...settings, startupConnection: null })
    }
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    delete state.passwords[profileId]
    delete state.commandAliases[profileId]
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
  ipcMain.handle('settings:get', () => readAppSettings())
  ipcMain.handle('settings:save', (_event, input: AppSettings) => {
    const settings = validateAppSettings(input)
    if (settings.startupConnection
      && !readState().profiles.some((profile) => profile.id === settings.startupConnection?.profileId)) {
      throw new Error('启动连接所选服务器不存在')
    }
    return writeAppSettings(settings)
  })
  ipcMain.handle('shell:open-external', (_event, url: unknown) => shell.openExternal(validateExternalUrl(url)))
  ipcMain.handle('aliases:list', () => listCommandAliasSnapshots())
  ipcMain.handle('aliases:sync', (_event, profileId: string) => synchronizeCommandAliases(profileId))
  ipcMain.handle('aliases:save', (_event, profileId: string, name: string, command: string, overwrite: boolean) =>
    saveCommandAlias(profileId, name, command, overwrite))
  ipcMain.handle('aliases:delete', (_event, profileId: string, name: string) => deleteCommandAlias(profileId, name))
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
      (signal) => uploadSelection(event, requestId, sessionId, profileId, remoteDirectory, false, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) })
  })
  ipcMain.handle('files:upload-folder', (event, requestId: string, sessionId: string, remoteDirectory: string) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => uploadSelection(event, requestId, sessionId, profileId, remoteDirectory, true, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) })
  })
  ipcMain.handle('files:upload-dropped', (event, requestId: string, sessionId: string, remoteDirectory: string, entries: unknown) => {
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => uploadDroppedEntries(event, requestId, sessionId, profileId, remoteDirectory, entries, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) })
  })
  ipcMain.handle('files:download', (event, requestId: string, sessionId: string, remotePaths: unknown) => {
    const paths = validateDownloadPaths(remotePaths)
    const { profileId } = transferSession(sessionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => downloadEntries(event, requestId, sessionId, profileId, paths, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) })
  })
  ipcMain.handle('files:transfer-cancel', (_event, requestId: string) => cancelTransfer(requestId))
  ipcMain.handle('files:move-start', (event, value: unknown) => {
    const request = parseRemoteMoveRequest(value)
    const session = sessions.get(request.sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    const sender = event.sender
    if (activeMoveOwners.has(request.requestId)) throw new Error('移动请求编号已在使用')
    activeMoveOwners.set(request.requestId, sender.id)
    const onSenderDestroyed = () => cancelRemoteMove(request.requestId)
    let run: ReturnType<typeof startRemoteMove>
    try {
      run = startRemoteMove(session.sftp, request, {
        onEvent: (moveEvent) => {
          if (!sender.isDestroyed()) sender.send('files:move-event', moveEvent)
        },
        askConflict: (conflict, signal) => new Promise((resolve) => {
          if (signal.aborted || sender.isDestroyed()) {
            resolve('cancel')
            return
          }
          const previous = pendingMoveDecisions.get(request.requestId)
          if (previous) throw new Error('移动任务同时出现多个冲突')
          const finish = (decision: RemoteMoveDecision) => {
            signal.removeEventListener('abort', onAbort)
            if (pendingMoveDecisions.get(request.requestId)?.conflictId === conflict.conflictId) {
              pendingMoveDecisions.delete(request.requestId)
            }
            resolve(decision)
          }
          const onAbort = () => finish('cancel')
          pendingMoveDecisions.set(request.requestId, {
            conflictId: conflict.conflictId,
            senderId: sender.id,
            resolve: finish,
          })
          signal.addEventListener('abort', onAbort, { once: true })
          sender.send('files:move-event', { type: 'conflict', conflict })
        }),
      })
    } catch (error) {
      activeMoveOwners.delete(request.requestId)
      throw error
    }
    sender.once('destroyed', onSenderDestroyed)
    return run.finally(() => {
      sender.removeListener('destroyed', onSenderDestroyed)
      activeMoveOwners.delete(request.requestId)
      const pending = pendingMoveDecisions.get(request.requestId)
      if (pending) pending.resolve('cancel')
    })
  })
  ipcMain.handle('files:move-decision', (event, requestId: unknown, conflictId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string' || typeof conflictId !== 'string'
      || !['replace', 'skip', 'replace-all', 'skip-all', 'cancel'].includes(String(decision))) return false
    const pending = pendingMoveDecisions.get(requestId)
    if (!pending || pending.senderId !== event.sender.id || pending.conflictId !== conflictId) return false
    pending.resolve(decision as RemoteMoveDecision)
    return true
  })
  ipcMain.handle('files:move-cancel', (event, requestId: unknown) => {
    if (typeof requestId !== 'string' || activeMoveOwners.get(requestId) !== event.sender.id) return false
    return cancelRemoteMove(requestId)
  })
  ipcMain.handle('files:copy-start', (event, value: unknown) => {
    const request = parseRemoteCopyRequest(value)
    const session = sessions.get(request.sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    const sender = event.sender
    if (activeCopyOwners.has(request.requestId)) throw new Error('复制请求编号已在使用')
    activeCopyOwners.set(request.requestId, sender.id)
    const onSenderDestroyed = () => pendingCopyDecisions.get(request.requestId)?.resolve('cancel')
    let run: ReturnType<typeof executeRemoteCopy>
    try {
      run = executeRemoteCopy(session.sftp, request, {
        onEvent: (copyEvent) => {
          if (!sender.isDestroyed()) sender.send('files:copy-event', copyEvent)
        },
        askConflict: (conflict) => new Promise((resolve) => {
          if (sender.isDestroyed()) {
            resolve('cancel')
            return
          }
          if (pendingCopyDecisions.has(request.requestId)) throw new Error('复制任务同时出现多个冲突')
          const finish = (decision: RemoteCopyDecision) => {
            if (pendingCopyDecisions.get(request.requestId)?.conflictId === conflict.conflictId) {
              pendingCopyDecisions.delete(request.requestId)
            }
            resolve(decision)
          }
          pendingCopyDecisions.set(request.requestId, {
            conflictId: conflict.conflictId,
            senderId: sender.id,
            resolve: finish,
          })
          sender.send('files:copy-event', { type: 'conflict', conflict })
        }),
      })
    } catch (error) {
      activeCopyOwners.delete(request.requestId)
      throw error
    }
    sender.once('destroyed', onSenderDestroyed)
    return run.finally(() => {
      sender.removeListener('destroyed', onSenderDestroyed)
      activeCopyOwners.delete(request.requestId)
      const pending = pendingCopyDecisions.get(request.requestId)
      if (pending) pending.resolve('cancel')
    })
  })
  ipcMain.handle('files:copy-decision', (event, requestId: unknown, conflictId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string' || typeof conflictId !== 'string'
      || !['replace', 'skip', 'replace-all', 'skip-all', 'cancel'].includes(String(decision))) return false
    const pending = pendingCopyDecisions.get(requestId)
    if (!pending || pending.senderId !== event.sender.id || pending.conflictId !== conflictId) return false
    pending.resolve(decision as RemoteCopyDecision)
    return true
  })
  ipcMain.handle('files:create-directory', (_event, sessionId: string, remoteDirectory: string, name: string) =>
    createRemoteDirectory(sessionId, remoteDirectory, name))
  ipcMain.handle('files:path-copy', (_event, sessionId: string, remotePath: string) => copyRemotePath(sessionId, remotePath))
  ipcMain.handle('files:delete', (_event, sessionId: string, remotePath: string) => deleteRemoteEntry(sessionId, remotePath))
  ipcMain.handle('files:preview', (_event, sessionId: string, remotePath: string, type: Parameters<typeof previewFile>[2]) =>
    previewFile(sessionId, remotePath, type))
  ipcMain.handle('files:text-save', (_event, sessionId: string, remotePath: string, content: string, expectedRevision: unknown) =>
    saveTextFile(sessionId, remotePath, content, expectedRevision))
  ipcMain.handle('files:preview-log', (_event, sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(sessionId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
