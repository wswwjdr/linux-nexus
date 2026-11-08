import { msg, LocalizedError } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import type { TextEncoding, TextSaveOptions, ContentSearchRequest, NameSearchRequest, OperationExecutionStrategy, ScriptExecutionRequest, UploadExecutionRequest } from '@shared/types'
import { copyRemotePath, createRemoteDirectory, deleteRemoteEntries, listDirectory } from '../connections'
import { cancelTransfer, downloadEntries, executeSelectedUpload, selectUploadSources, uploadSelectionContext, cancelUploadSelection, validateDownloadPaths, withTransferLock } from '../transfers'
import { previewFile, readLogPreview, releasePreview, saveTextFile } from '../previews'
import { installTextSaveDependencies } from '../previews/text-save-dependencies'
import { cancelNameSearch, startNameSearch } from '../name-search'
import { cancelContentSearch, startContentSearch } from '../content-search'
import { cancelScriptExecution, startScriptExecution } from '../script-execution-runtime'
import { filesSession, renameRemoteEntry } from '../remote-fs'
import { getRemoteEntryProperties, getRemoteDirectoryDiskUsage } from '../file-properties'
import { cancelFileRootEntry, enterFileRoot, leaveFileRoot } from '../file-identity'

export function registerFilesIpc(): void {
  ipcMain.handle('files:root-enter', (_event, sessionId: unknown, password?: unknown) => enterFileRoot(sessionId, password))
  ipcMain.handle('files:root-cancel', (_event, sessionId: unknown) => cancelFileRootEntry(sessionId))
  ipcMain.handle('files:root-leave', (_event, sessionId: unknown) => leaveFileRoot(sessionId))
  ipcMain.handle('files:properties', (_event, sessionId: string, remotePath: string) =>
    getRemoteEntryProperties(sessionId, remotePath))
  ipcMain.handle('files:directory-disk-usage', (_event, sessionId: string, remotePath: string) =>
    getRemoteDirectoryDiskUsage(sessionId, remotePath))
  ipcMain.handle('files:list', (_event, sessionId: string, remotePath: string) =>
    listDirectory(sessionId, remotePath))
  ipcMain.handle('files:name-search', (_event, request: NameSearchRequest) => startNameSearch(request))
  ipcMain.handle('files:name-search-cancel', (_event, requestId: string) => cancelNameSearch(requestId))
  ipcMain.handle('files:content-search', (_event, request: ContentSearchRequest) => startContentSearch(request))
  ipcMain.handle('files:content-search-cancel', (_event, requestId: string) => cancelContentSearch(requestId))
  ipcMain.handle('files:script-execution-start', (_event, request: ScriptExecutionRequest) => startScriptExecution(request))
  ipcMain.handle('files:script-execution-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId) throw new LocalizedError(msg('errors.invalidScriptExecutionRequestId'))
    return cancelScriptExecution(requestId)
  })
  ipcMain.handle('files:upload-select', (_event, request: unknown) => selectUploadSources(request))
  ipcMain.handle('files:upload-execute', (event, request: unknown) => {
    if (typeof request !== 'object' || request === null || !('selectionId' in request)
      || typeof request.selectionId !== 'string' || !request.selectionId
      || !('strategy' in request) || typeof request.strategy !== 'string') throw new LocalizedError(msg('errors.invalidUploadExecutionParameters'))
    if (!['force', 'skip', 'update'].includes(request.strategy)) throw new LocalizedError(msg('errors.invalidUploadStrategy'))
    const uploadRequest = request as unknown as UploadExecutionRequest
    const selectionId = uploadRequest.selectionId
    const { requestId, sessionId, profileId, commands } = uploadSelectionContext(selectionId)
    return commands.track(withTransferLock(profileId, sessionId, requestId,
      (signal) => executeSelectedUpload(event, selectionId, uploadRequest.strategy as OperationExecutionStrategy, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) }))
  })
  ipcMain.handle('files:upload-selection-cancel', (_event, selectionId: unknown) => {
    if (typeof selectionId !== 'string' || !selectionId) throw new LocalizedError(msg('errors.invalidUploadSelectionId'))
    return cancelUploadSelection(selectionId)
  })
  ipcMain.handle('files:download', (event, requestId: string, sessionId: string, remotePaths: unknown) => {
    const paths = validateDownloadPaths(remotePaths)
    const session = filesSession(sessionId)
    return session.commands.track(withTransferLock(session.profileId, sessionId, requestId,
      (signal) => downloadEntries(event, requestId, session, paths, signal),
      () => { if (!event.sender.isDestroyed()) event.sender.send('files:transfer-queued', { requestId }) }))
  })
  ipcMain.handle('files:transfer-cancel', (_event, requestId: string) => cancelTransfer(requestId))
  ipcMain.handle('files:create-directory', (_event, sessionId: string, remoteDirectory: string, name: string) =>
    createRemoteDirectory(sessionId, remoteDirectory, name))
  ipcMain.handle('files:rename', (_event, sessionId: string, remotePath: string, name: string) =>
    renameRemoteEntry(sessionId, remotePath, name))
  ipcMain.handle('files:path-copy', (_event, sessionId: string, remotePath: string) => copyRemotePath(sessionId, remotePath))
  ipcMain.handle('files:delete', (_event, sessionId: string, remotePaths: unknown) => {
    if (!Array.isArray(remotePaths) || remotePaths.some((remotePath) => typeof remotePath !== 'string')) {
      throw new LocalizedError(msg('errors.invalidDeletionPath'))
    }
    return deleteRemoteEntries(sessionId, remotePaths as string[])
  })
  ipcMain.handle('files:preview', (_event, sessionId: string, remotePath: string, type: Parameters<typeof previewFile>[2], encoding?: TextEncoding) =>
    previewFile(sessionId, remotePath, type, encoding))
  ipcMain.handle('files:text-save', (_event, sessionId: string, remotePath: string, content: string, lineEnding: unknown, options: TextSaveOptions) =>
    saveTextFile(sessionId, remotePath, content, lineEnding, options))
  ipcMain.handle('files:text-save-install-dependencies', (_event, sessionId: string, packages: unknown, password: unknown) =>
    installTextSaveDependencies(sessionId, packages, password))
  ipcMain.handle('files:preview-log', (_event, sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
    readLogPreview(sessionId, remotePath, beforeOffset, snapshotSize))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}
