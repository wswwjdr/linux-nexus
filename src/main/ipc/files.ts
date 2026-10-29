import { ipcMain } from 'electron'
import type { ContentSearchRequest, NameSearchRequest, OperationExecutionStrategy, ScriptExecutionRequest, UploadExecutionRequest } from '@shared/types'
import { copyRemotePath, createRemoteDirectory, deleteRemoteEntries, listDirectory } from '../connections'
import { cancelTransfer, downloadEntries, executeSelectedUpload, selectUploadSources, uploadSelectionContext, cancelUploadSelection, validateDownloadPaths, withTransferLock } from '../transfers'
import { previewFile, readLogPreview, releasePreview, saveTextFile } from '../previews'
import { cancelNameSearch, startNameSearch } from '../name-search'
import { cancelContentSearch, startContentSearch } from '../content-search'
import { cancelScriptExecution, startScriptExecution } from '../script-execution-runtime'
import { filesSession, renameRemoteEntry } from '../remote-fs'

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
    return filesSession(sessionId)
  }
  ipcMain.handle('files:upload-select', (_event, request: unknown) => selectUploadSources(request))
  ipcMain.handle('files:upload-execute', (event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('selectionId' in request)
      || typeof request.selectionId !== 'string' || !request.selectionId
      || !('strategy' in request) || typeof request.strategy !== 'string') throw new Error('上传执行参数无效')
    if (!['force', 'skip', 'update'].includes(request.strategy)) throw new Error('上传策略无效')
    const uploadRequest = request as unknown as UploadExecutionRequest
    const selectionId = uploadRequest.selectionId
    const { requestId, sessionId, profileId } = uploadSelectionContext(selectionId)
    return withTransferLock(profileId, sessionId, requestId,
      (signal) => executeSelectedUpload(event, selectionId, uploadRequest.strategy as OperationExecutionStrategy, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) })
  })
  ipcMain.handle('files:upload-selection-cancel', (_event, selectionId: unknown) => {
    if (typeof selectionId !== 'string' || !selectionId) throw new Error('上传选择编号无效')
    return cancelUploadSelection(selectionId)
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
  ipcMain.handle('files:rename', (_event, sessionId: string, remotePath: string, name: string) =>
    renameRemoteEntry(sessionId, remotePath, name))
  ipcMain.handle('files:path-copy', (_event, sessionId: string, remotePath: string) => copyRemotePath(sessionId, remotePath))
  ipcMain.handle('files:delete', (_event, sessionId: string, remotePaths: unknown) => {
    if (!Array.isArray(remotePaths) || remotePaths.some((remotePath) => typeof remotePath !== 'string')) {
      throw new Error('删除路径无效')
    }
    return deleteRemoteEntries(sessionId, remotePaths as string[])
  })
  ipcMain.handle('files:preview', (_event, sessionId: string, remotePath: string, type: Parameters<typeof previewFile>[2]) =>
    previewFile(sessionId, remotePath, type))
  ipcMain.handle('files:text-save', (_event, sessionId: string, remotePath: string, content: string, lineEnding: unknown) =>
    saveTextFile(sessionId, remotePath, content, lineEnding))
  ipcMain.handle('files:preview-log', (_event, sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(sessionId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
