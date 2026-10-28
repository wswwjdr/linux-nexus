import { ipcMain } from 'electron'
import type { ContentSearchRequest, NameSearchRequest, ScriptExecutionRequest } from '@shared/types'
import { copyRemotePath, createRemoteDirectory, deleteRemoteEntry, listDirectory } from '../connections'
import { cancelTransfer, downloadEntries, uploadDroppedEntries, uploadSelection, validateDownloadPaths, withTransferLock } from '../transfers'
import { previewFile, readLogPreview, releasePreview, saveTextFile } from '../previews'
import { cancelNameSearch, startNameSearch } from '../name-search'
import { cancelContentSearch, startContentSearch } from '../content-search'
import { cancelScriptExecution, startScriptExecution } from '../script-execution-runtime'
import { sessions } from '../runtime'
import { cancelRemoteArchiveExtraction, startRemoteArchiveExtraction } from '../archives'
import type { RemoteArchiveDecision, RemoteArchiveRequest } from '@shared/types'

const pendingArchiveDecisions = new Map<string, {
  conflictId: string
  senderId: number
  resolve: (decision: RemoteArchiveDecision) => void
}>()
const activeArchiveOwners = new Map<string, number>()

function parseArchiveRequest(value: unknown): RemoteArchiveRequest {
  if (!value || typeof value !== 'object') throw new Error('解压请求无效')
  const request = value as Partial<RemoteArchiveRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.archivePath !== 'string' || !request.archivePath
    || typeof request.targetDirectory !== 'string'
    || typeof request.wrapInDirectory !== 'boolean') {
    throw new Error('解压请求参数无效')
  }
  return request as RemoteArchiveRequest
}

export function registerFilesIpc(): void {
  ipcMain.handle('files:list', (_event, sessionId: string, remotePath: string) =>
    listDirectory(sessionId, remotePath))
  ipcMain.handle('files:name-search', (_event, request: NameSearchRequest) => startNameSearch(request))
  ipcMain.handle('files:name-search-cancel', (_event, requestId: string) => cancelNameSearch(requestId))
  ipcMain.handle('files:content-search', (_event, request: ContentSearchRequest) => startContentSearch(request))
  ipcMain.handle('files:content-search-cancel', (_event, requestId: string) => cancelContentSearch(requestId))
  ipcMain.handle('files:script-execution-start', (_event, request: ScriptExecutionRequest) => startScriptExecution(request))
  ipcMain.handle('files:script-execution-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId) throw new Error('脚本执行请求编号无效')
    return cancelScriptExecution(requestId)
  })
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
  ipcMain.handle('files:create-directory', (_event, sessionId: string, remoteDirectory: string, name: string) =>
    createRemoteDirectory(sessionId, remoteDirectory, name))
  ipcMain.handle('files:path-copy', (_event, sessionId: string, remotePath: string) => copyRemotePath(sessionId, remotePath))
  ipcMain.handle('files:delete', (_event, sessionId: string, remotePath: string) => deleteRemoteEntry(sessionId, remotePath))
  ipcMain.handle('files:extract-archive-start', (event, value: unknown) => {
    const request = parseArchiveRequest(value)
    const session = sessions.get(request.sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    const sender = event.sender
    if (activeArchiveOwners.has(request.requestId)) throw new Error('解压请求编号已在使用')
    activeArchiveOwners.set(request.requestId, sender.id)
    const onSenderDestroyed = () => cancelRemoteArchiveExtraction(request.requestId)
    let run: ReturnType<typeof startRemoteArchiveExtraction>
    try {
      run = startRemoteArchiveExtraction(session.client, session.sftp, request, {
        onEvent: (archiveEvent) => {
          if (archiveEvent.type === 'progress' && !sender.isDestroyed()) sender.send('files:extract-archive-event', archiveEvent)
        },
        askConflict: (conflict, signal) => new Promise((resolve) => {
          if (signal.aborted || sender.isDestroyed()) {
            resolve('cancel')
            return
          }
          if (pendingArchiveDecisions.has(request.requestId)) throw new Error('解压任务同时出现多个冲突')
          const finish = (decision: RemoteArchiveDecision) => {
            signal.removeEventListener('abort', onAbort)
            if (pendingArchiveDecisions.get(request.requestId)?.conflictId === conflict.conflictId) {
              pendingArchiveDecisions.delete(request.requestId)
            }
            resolve(decision)
          }
          const onAbort = () => finish('cancel')
          pendingArchiveDecisions.set(request.requestId, {
            conflictId: conflict.conflictId,
            senderId: sender.id,
            resolve: finish,
          })
          signal.addEventListener('abort', onAbort, { once: true })
          if (!sender.isDestroyed()) sender.send('files:extract-archive-event', { type: 'conflict', conflict })
        }),
      })
    } catch (error) {
      activeArchiveOwners.delete(request.requestId)
      throw error
    }
    sender.once('destroyed', onSenderDestroyed)
    return run.finally(() => {
      sender.removeListener('destroyed', onSenderDestroyed)
      activeArchiveOwners.delete(request.requestId)
      pendingArchiveDecisions.get(request.requestId)?.resolve('cancel')
    })
  })
  ipcMain.handle('files:extract-archive-decision', (event, requestId: unknown, conflictId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string' || typeof conflictId !== 'string'
      || !['replace', 'skip', 'rename', 'replace-all', 'skip-all', 'rename-all', 'cancel'].includes(String(decision))) return false
    const pending = pendingArchiveDecisions.get(requestId)
    if (!pending || pending.senderId !== event.sender.id || pending.conflictId !== conflictId) return false
    pending.resolve(decision as RemoteArchiveDecision)
    return true
  })
  ipcMain.handle('files:extract-archive-cancel', (event, requestId: unknown) => {
    if (typeof requestId !== 'string' || activeArchiveOwners.get(requestId) !== event.sender.id) return false
    return cancelRemoteArchiveExtraction(requestId)
  })
  ipcMain.handle('files:preview', (_event, sessionId: string, remotePath: string, type: Parameters<typeof previewFile>[2]) =>
    previewFile(sessionId, remotePath, type))
  ipcMain.handle('files:text-save', (_event, sessionId: string, remotePath: string, content: string, expectedRevision: unknown) =>
    saveTextFile(sessionId, remotePath, content, expectedRevision))
  ipcMain.handle('files:preview-log', (_event, sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(sessionId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
