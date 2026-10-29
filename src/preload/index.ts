import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ConnectionClosedEvent,
  CommandAliasOperationResult,
  CommandAliasSnapshot,
  DroppedUploadEntry,
  LogPreviewPage,
  OperationExecutionRequest,
  OperationExecutionResult,
  UploadSelectionRequest,
  UploadSelection,
  UploadExecutionRequest,
  PreviewResult,
  PreviewType,
  PerformanceMonitorState,
  AppSettings,
  AppSettingsPatch,
  RemoteFilesApi,
  ContentSearchEvent,
  ContentSearchRequest,
  NameSearchEvent,
  NameSearchRequest,
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
  setProfilePinned: (profileId: string, pinned: boolean) => ipcRenderer.invoke('profiles:set-pinned', profileId, pinned),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) =>
    ipcRenderer.invoke('connection:connect', sessionId, profileId, kind, cols, rows, startPath),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (sessionId: string) => ipcRenderer.invoke('connection:disconnect', sessionId),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  getPerformanceMonitorState: (sessionId: string): Promise<PerformanceMonitorState> => ipcRenderer.invoke('performance:state', sessionId),
  activatePerformanceMonitor: (sessionId: string): Promise<PerformanceMonitorState> => ipcRenderer.invoke('performance:activate', sessionId),
  deactivatePerformanceMonitor: (sessionId: string): Promise<void> => ipcRenderer.invoke('performance:deactivate', sessionId),
  refreshPerformanceMonitor: (sessionId: string): Promise<void> => ipcRenderer.invoke('performance:refresh', sessionId),
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateAppSettings: (patch: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:update', patch),
  listCommandAliasSnapshots: (): Promise<CommandAliasSnapshot[]> => ipcRenderer.invoke('aliases:list'),
  syncCommandAliases: (profileId: string): Promise<CommandAliasOperationResult> => ipcRenderer.invoke('aliases:sync', profileId),
  saveCommandAlias: (profileId: string, name: string, command: string, existingCommand?: string): Promise<CommandAliasOperationResult> =>
    ipcRenderer.invoke('aliases:save', profileId, name, command, existingCommand),
  deleteCommandAlias: (profileId: string, name: string, expectedCommand: string): Promise<CommandAliasOperationResult> =>
    ipcRenderer.invoke('aliases:delete', profileId, name, expectedCommand),
  listDirectory: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', sessionId, remotePath),
  startNameSearch: (request: NameSearchRequest) => ipcRenderer.invoke('files:name-search', request),
  cancelNameSearch: (requestId: string) => ipcRenderer.invoke('files:name-search-cancel', requestId),
  startContentSearch: (request: ContentSearchRequest) => ipcRenderer.invoke('files:content-search', request),
  cancelContentSearch: (requestId: string) => ipcRenderer.invoke('files:content-search-cancel', requestId),
  startScriptExecution: (request: ScriptExecutionRequest): Promise<void> => ipcRenderer.invoke('files:script-execution-start', request),
  cancelScriptExecution: (requestId: string): Promise<boolean> => ipcRenderer.invoke('files:script-execution-cancel', requestId),
  selectUploadSources: (request: UploadSelectionRequest): Promise<UploadSelection | null> => ipcRenderer.invoke('files:upload-select', request),
  executeUpload: (request: UploadExecutionRequest) => ipcRenderer.invoke('files:upload-execute', request),
  cancelUploadSelection: (selectionId: string) => ipcRenderer.invoke('files:upload-selection-cancel', selectionId),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  downloadEntries: (requestId: string, sessionId: string, remotePaths: string[]) =>
    ipcRenderer.invoke('files:download', requestId, sessionId, remotePaths),
  cancelTransfer: (requestId: string) => ipcRenderer.invoke('files:transfer-cancel', requestId),
  executeOperation: (request: OperationExecutionRequest): Promise<OperationExecutionResult> => ipcRenderer.invoke('files:operation-execute', request),
  cancelOperation: (requestId: string): Promise<boolean> => ipcRenderer.invoke('files:operation-cancel', requestId),
  createRemoteDirectory: (sessionId: string, remoteDirectory: string, name: string) =>
    ipcRenderer.invoke('files:create-directory', sessionId, remoteDirectory, name),
  renameRemoteEntry: (sessionId: string, remotePath: string, name: string) =>
    ipcRenderer.invoke('files:rename', sessionId, remotePath, name),
  copyRemotePath: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:path-copy', sessionId, remotePath),
  deleteRemoteEntries: (sessionId: string, remotePaths: string[]) =>
    ipcRenderer.invoke('files:delete', sessionId, remotePaths),
  previewFile: (sessionId: string, remotePath: string, type: PreviewType): Promise<PreviewResult> =>
    ipcRenderer.invoke('files:preview', sessionId, remotePath, type),
  openExternalUrl: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  saveTextFile: (sessionId: string, remotePath: string, content: string, lineEnding) =>
    ipcRenderer.invoke('files:text-save', sessionId, remotePath, content, lineEnding),
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
  onNameSearchEvent: (callback: (event: NameSearchEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, searchEvent: NameSearchEvent) => callback(searchEvent)
    ipcRenderer.on('files:name-search-event', listener)
    return () => ipcRenderer.removeListener('files:name-search-event', listener)
  },
  onContentSearchEvent: (callback: (event: ContentSearchEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, searchEvent: ContentSearchEvent) => callback(searchEvent)
    ipcRenderer.on('files:content-search-event', listener)
    return () => ipcRenderer.removeListener('files:content-search-event', listener)
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
  onPerformanceUpdate: (callback: (event: PerformanceMonitorState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: PerformanceMonitorState) => callback(update)
    ipcRenderer.on('performance:update', listener)
    return () => ipcRenderer.removeListener('performance:update', listener)
  },
}

contextBridge.exposeInMainWorld('remoteFiles', api)
