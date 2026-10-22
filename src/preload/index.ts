import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ConnectionClosedEvent,
  CommandAliasOperationResult,
  CommandAliasSnapshot,
  DroppedUploadEntry,
  LogPreviewPage,
  RemoteMoveDecision,
  RemoteMoveEvent,
  RemoteMoveRequest,
  RemoteMoveResult,
  PreviewResult,
  PreviewType,
  PerformanceUpdate,
  AppSettings,
  AppSettingsPatch,
  RemoteCopyDecision,
  RemoteCopyEvent,
  RemoteCopyRequest,
  RemoteCopyResult,
  RemoteFilesApi,
  RemoteSearchEvent,
  RemoteSearchRequest,
  ScriptExecutionEvent,
  ScriptExecutionRequest,
  SaveProfileInput,
  TransferProgress,
  TransferQueuedEvent,
  TerminalOutputEvent,
  TrustHostKeyInput,
  SessionKind,
} from '@shared/types'

const api: RemoteFilesApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (input: SaveProfileInput) => ipcRenderer.invoke('profiles:save', input),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) =>
    ipcRenderer.invoke('connection:connect', sessionId, profileId, kind, cols, rows, startPath),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (sessionId: string) => ipcRenderer.invoke('connection:disconnect', sessionId),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  startPerformanceMonitor: (sessionId: string, monitorId: string) => ipcRenderer.invoke('performance:start', sessionId, monitorId),
  stopPerformanceMonitor: (sessionId: string, monitorId: string) => ipcRenderer.invoke('performance:stop', sessionId, monitorId),
  refreshPerformanceMonitor: (sessionId: string, monitorId: string) => ipcRenderer.invoke('performance:refresh', sessionId, monitorId),
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateAppSettings: (patch: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch),
  listCommandAliasSnapshots: (): Promise<CommandAliasSnapshot[]> => ipcRenderer.invoke('aliases:list'),
  syncCommandAliases: (profileId: string): Promise<CommandAliasOperationResult> => ipcRenderer.invoke('aliases:sync', profileId),
  saveCommandAlias: (profileId: string, name: string, command: string, overwrite: boolean): Promise<CommandAliasOperationResult> =>
    ipcRenderer.invoke('aliases:save', profileId, name, command, overwrite),
  deleteCommandAlias: (profileId: string, name: string): Promise<CommandAliasOperationResult> =>
    ipcRenderer.invoke('aliases:delete', profileId, name),
  listDirectory: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', sessionId, remotePath),
  searchFiles: (request: RemoteSearchRequest) => ipcRenderer.invoke('files:search', request),
  cancelSearch: (requestId: string) => ipcRenderer.invoke('files:search-cancel', requestId),
  startScriptExecution: (request: ScriptExecutionRequest): Promise<void> => ipcRenderer.invoke('files:script-execution-start', request),
  cancelScriptExecution: (requestId: string): Promise<boolean> => ipcRenderer.invoke('files:script-execution-cancel', requestId),
  uploadFiles: (requestId: string, sessionId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-files', requestId, sessionId, remoteDirectory),
  uploadFolder: (requestId: string, sessionId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-folder', requestId, sessionId, remoteDirectory),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  uploadDroppedEntries: (
    requestId: string,
    sessionId: string,
    remoteDirectory: string,
    entries: DroppedUploadEntry[],
  ) => ipcRenderer.invoke('files:upload-dropped', requestId, sessionId, remoteDirectory, entries),
  downloadEntries: (requestId: string, sessionId: string, remotePaths: string[]) =>
    ipcRenderer.invoke('files:download', requestId, sessionId, remotePaths),
  cancelTransfer: (requestId: string) => ipcRenderer.invoke('files:transfer-cancel', requestId),
  moveRemoteEntries: (request: RemoteMoveRequest): Promise<RemoteMoveResult> => ipcRenderer.invoke('files:move-start', request),
  decideRemoteMove: (requestId: string, conflictId: string, decision: RemoteMoveDecision): Promise<boolean> =>
    ipcRenderer.invoke('files:move-decision', requestId, conflictId, decision),
  cancelRemoteMove: (requestId: string): Promise<boolean> => ipcRenderer.invoke('files:move-cancel', requestId),
  copyRemoteEntries: (request: RemoteCopyRequest): Promise<RemoteCopyResult> => ipcRenderer.invoke('files:copy-start', request),
  decideRemoteCopy: (requestId: string, conflictId: string, decision: RemoteCopyDecision): Promise<boolean> =>
    ipcRenderer.invoke('files:copy-decision', requestId, conflictId, decision),
  createRemoteDirectory: (sessionId: string, remoteDirectory: string, name: string) =>
    ipcRenderer.invoke('files:create-directory', sessionId, remoteDirectory, name),
  copyRemotePath: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:path-copy', sessionId, remotePath),
  deleteRemoteEntry: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:delete', sessionId, remotePath),
  previewFile: (sessionId: string, remotePath: string, type: PreviewType): Promise<PreviewResult> =>
    ipcRenderer.invoke('files:preview', sessionId, remotePath, type),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  saveTextFile: (sessionId: string, remotePath: string, content: string, expectedRevision) =>
    ipcRenderer.invoke('files:text-save', sessionId, remotePath, content, expectedRevision),
  readLogPreview: (sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number): Promise<LogPreviewPage> =>
    ipcRenderer.invoke('files:preview-log', sessionId, remotePath, beforeOffset, snapshotSize),
  releasePreview: (token: string) => ipcRenderer.invoke('files:preview-release', token),
  onTransferProgress: (callback: (progress: TransferProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TransferProgress) => callback(progress)
    ipcRenderer.on('files:transfer-progress', listener)
    return () => ipcRenderer.removeListener('files:transfer-progress', listener)
  },
  onTransferQueued: (callback: (event: TransferQueuedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, queuedEvent: TransferQueuedEvent) => callback(queuedEvent)
    ipcRenderer.on('files:transfer-queued', listener)
    return () => ipcRenderer.removeListener('files:transfer-queued', listener)
  },
  onRemoteMoveEvent: (callback: (event: RemoteMoveEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, moveEvent: RemoteMoveEvent) => callback(moveEvent)
    ipcRenderer.on('files:move-event', listener)
    return () => ipcRenderer.removeListener('files:move-event', listener)
  },
  onRemoteCopyEvent: (callback: (event: RemoteCopyEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, copyEvent: RemoteCopyEvent) => callback(copyEvent)
    ipcRenderer.on('files:copy-event', listener)
    return () => ipcRenderer.removeListener('files:copy-event', listener)
  },
  onSearchEvent: (callback: (event: RemoteSearchEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, searchEvent: RemoteSearchEvent) => callback(searchEvent)
    ipcRenderer.on('files:search-event', listener)
    return () => ipcRenderer.removeListener('files:search-event', listener)
  },
  onScriptExecutionEvent: (callback: (event: ScriptExecutionEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, executionEvent: ScriptExecutionEvent) => callback(executionEvent)
    ipcRenderer.on('files:script-execution-event', listener)
    return () => ipcRenderer.removeListener('files:script-execution-event', listener)
  },
  onConnectionClosed: (callback: (event: ConnectionClosedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ConnectionClosedEvent) => callback(event)
    ipcRenderer.on('connection:closed', listener)
    return () => ipcRenderer.removeListener('connection:closed', listener)
  },
  onTerminalOutput: (callback: (event: TerminalOutputEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, output: TerminalOutputEvent) => callback(output)
    ipcRenderer.on('terminal:output', listener)
    return () => ipcRenderer.removeListener('terminal:output', listener)
  },
  onPerformanceUpdate: (callback: (event: PerformanceUpdate) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: PerformanceUpdate) => callback(update)
    ipcRenderer.on('performance:update', listener)
    return () => ipcRenderer.removeListener('performance:update', listener)
  },
}

contextBridge.exposeInMainWorld('remoteFiles', api)
