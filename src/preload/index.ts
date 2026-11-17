import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AssistantEvent, AssistantRequest } from '@shared/types/assistant'
import type {
  ConnectionClosedEvent,
  FileRootExpiredEvent,
  OperationExecutionRequest,
  UploadSelectionRequest,
  UploadExecutionRequest,
  PreviewType,
  TextEncoding,
  TextSaveOptions,
  PerformanceMonitorState,
  AppSettingsPatch,
  RemoteFilesTransport,
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

const api: RemoteFilesTransport = {
  /** Sends a validated assistant request to the main process. */
  assistant: (request: AssistantRequest) => ipcRenderer.invoke('assistant:request', request),
  /** Subscribes to assistant updates and returns a function to remove the listener. */
  onAssistantEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: AssistantEvent) => callback(value)
    ipcRenderer.on('assistant:event', listener)
    return () => ipcRenderer.removeListener('assistant:event', listener)
  },
  getBootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  onWindowExpanded: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, expanded: boolean) => callback(expanded)
    ipcRenderer.on('app:window-expanded', listener)
    return () => ipcRenderer.removeListener('app:window-expanded', listener)
  },
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (input: SaveProfileInput) => ipcRenderer.invoke('profiles:save', input),
  setProfilePinned: (profileId: string, pinned: boolean) => ipcRenderer.invoke('profiles:set-pinned', profileId, pinned),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (sessionId, profileId, kind, cols, rows, startPath, rootSourceSessionId) =>
    ipcRenderer.invoke('connection:connect', sessionId, profileId, kind, cols, rows, startPath, rootSourceSessionId),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (sessionId: string) => ipcRenderer.invoke('connection:disconnect', sessionId),
  enterFileRoot: (sessionId, password) => ipcRenderer.invoke('files:root-enter', sessionId, password),
  cancelFileRootEntry: (sessionId) => ipcRenderer.invoke('files:root-cancel', sessionId),
  leaveFileRoot: (sessionId) => ipcRenderer.invoke('files:root-leave', sessionId),
  onFileRootExpired: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: FileRootExpiredEvent) => callback(state)
    ipcRenderer.on('files:root-expired', listener)
    return () => ipcRenderer.removeListener('files:root-expired', listener)
  },
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  /**
   * Reads a server's current monitor snapshot.
   * @param profileId Server configuration ID.
   * @returns The current monitor state.
   */
  getPerformanceMonitorState: (profileId: string) => ipcRenderer.invoke('performance:snapshot', profileId),
  /**
   * Changes a server's shared monitor switch.
   * @param profileId Server configuration ID.
   * @param enabled Desired switch value.
   * @returns The updated monitor state.
   */
  setPerformanceMonitorEnabled: (profileId: string, enabled: boolean) => ipcRenderer.invoke('performance:set-enabled', profileId, enabled),
  /**
   * Requests fresh samples for a server.
   * @param profileId Server configuration ID.
   * @returns A promise that resolves when the request is accepted.
   */
  refreshPerformanceMonitor: (profileId: string) => ipcRenderer.invoke('performance:refresh', profileId),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  updateAppSettings: (patch: AppSettingsPatch) => ipcRenderer.invoke('settings:update', patch),
  listCommandAliasSnapshots: () => ipcRenderer.invoke('aliases:list'),
  syncCommandAliases: (profileId: string) => ipcRenderer.invoke('aliases:sync', profileId),
  saveCommandAlias: (profileId: string, name: string, command: string, existingCommand?: string) =>
    ipcRenderer.invoke('aliases:save', profileId, name, command, existingCommand),
  deleteCommandAlias: (profileId: string, name: string, expectedCommand: string) =>
    ipcRenderer.invoke('aliases:delete', profileId, name, expectedCommand),
  listDirectory: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', sessionId, remotePath),
  /**
   * Resolves the file browser destination for a remote path.
   * @param sessionId Connected file session.
   * @param remotePath Path entered or selected by the user.
   * @returns The destination path and type.
   */
  resolveRemoteNavigationTarget: (sessionId, remotePath) =>
    ipcRenderer.invoke('files:resolve-navigation-target', sessionId, remotePath),
  getRemoteEntryProperties: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:properties', sessionId, remotePath),
  getRemoteDirectoryStats: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:directory-stats', sessionId, remotePath),
  getRemoteDirectoryUsageTree: (sessionId, remotePath, requestId) =>
    ipcRenderer.invoke('files:directory-usage-tree', sessionId, remotePath, requestId),
  cancelRemoteDirectoryUsageTree: (requestId) => ipcRenderer.invoke('files:directory-usage-tree-cancel', requestId),
  startNameSearch: (request: NameSearchRequest) => ipcRenderer.invoke('files:name-search', request),
  cancelNameSearch: (requestId: string) => ipcRenderer.invoke('files:name-search-cancel', requestId),
  startContentSearch: (request: ContentSearchRequest) => ipcRenderer.invoke('files:content-search', request),
  cancelContentSearch: (requestId: string) => ipcRenderer.invoke('files:content-search-cancel', requestId),
  startScriptExecution: (request: ScriptExecutionRequest) => ipcRenderer.invoke('files:script-execution-start', request),
  cancelScriptExecution: (requestId: string) => ipcRenderer.invoke('files:script-execution-cancel', requestId),
  selectUploadSources: (request: UploadSelectionRequest) => ipcRenderer.invoke('files:upload-select', request),
  executeUpload: (request: UploadExecutionRequest) => ipcRenderer.invoke('files:upload-execute', request),
  cancelUploadSelection: (selectionId: string) => ipcRenderer.invoke('files:upload-selection-cancel', selectionId),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  downloadEntries: (requestId: string, sessionId: string, remotePaths: string[]) =>
    ipcRenderer.invoke('files:download', requestId, sessionId, remotePaths),
  openLocalEdit: (sessionId, path) => ipcRenderer.invoke('files:local-edit-open', sessionId, path),
  listLocalEdits: () => ipcRenderer.invoke('files:local-edits-list'),
  uploadLocalEdit: id => ipcRenderer.invoke('files:local-edit-upload', id),
  restoreLocalEditPrompt: id => ipcRenderer.invoke('files:local-edit-restore-prompt', id),
  exportLocalEdit: id => ipcRenderer.invoke('files:local-edit-export', id),
  discardLocalEdit: id => ipcRenderer.invoke('files:local-edit-discard', id),
  onLocalEdits: callback => {
    const listener: Parameters<typeof ipcRenderer.on>[1] = (_event, update) => callback(update)
    ipcRenderer.on('files:local-edits', listener)
    return () => ipcRenderer.removeListener('files:local-edits', listener)
  },
  cancelTransfer: (requestId: string) => ipcRenderer.invoke('files:transfer-cancel', requestId),
  executeOperation: (request: OperationExecutionRequest) => ipcRenderer.invoke('files:operation-execute', request),
  cancelOperation: (requestId: string) => ipcRenderer.invoke('files:operation-cancel', requestId),
  createRemoteDirectory: (sessionId: string, remoteDirectory: string, name: string) =>
    ipcRenderer.invoke('files:create-directory', sessionId, remoteDirectory, name),
  renameRemoteEntry: (sessionId: string, remotePath: string, name: string) =>
    ipcRenderer.invoke('files:rename', sessionId, remotePath, name),
  copyRemotePath: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:path-copy', sessionId, remotePath),
  deleteRemoteEntries: (sessionId: string, remotePaths: string[]) =>
    ipcRenderer.invoke('files:delete', sessionId, remotePaths),
  previewFile: (sessionId: string, remotePath: string, type: PreviewType, encoding?: TextEncoding) =>
    ipcRenderer.invoke('files:preview', sessionId, remotePath, type, encoding),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  saveTextFile: (sessionId: string, remotePath: string, content: string, lineEnding, options: TextSaveOptions) =>
    ipcRenderer.invoke('files:text-save', sessionId, remotePath, content, lineEnding, options),
  installDependencies: (id, password) => ipcRenderer.invoke('dependencies:install', id, password),
  recheckDependencies: id => ipcRenderer.invoke('dependencies:recheck', id),
  cancelDependencies: id => ipcRenderer.invoke('dependencies:cancel', id),
  skipArchivePreparation: id => ipcRenderer.invoke('dependencies:skip-archive', id),
  readLogPreview: (sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number) =>
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

contextBridge.exposeInMainWorld('remoteFilesTransport', api)
