import { type IpcResult } from '../i18n/messages'
import type { RemoteEntry, RemoteNavigationTarget, SaveProfileInput, ServerProfile, CommandAliasOperationResult, CommandAliasSnapshot } from './profiles'
import type { NameSearchRequest, ContentSearchRequest, NameSearchEvent, ContentSearchEvent } from './search'
import type { ScriptExecutionRequest, ScriptExecutionEvent } from './script-executions'
import type { ConnectResult, TrustHostKeyInput, SessionKind, TerminalOutputEvent, ConnectionClosedEvent, FileElevationResult, FileRootExitResult, FileRootExpiredEvent } from './sessions'
import type { PerformanceMonitorState } from './performance'
import type { AppSettings, AppSettingsPatch, AppBootstrap } from './settings'
import type { DroppedUploadEntry, TransferResult, OperationExecutionRequest, OperationExecutionResult, UploadSelectionRequest, UploadSelection, UploadExecutionRequest, TransferProgress, TransferQueuedEvent } from './transfers'
import type { PreviewResult, TextLineEnding, LogPreviewPage, TextEncoding, TextSaveOptions, TextSaveResult } from './previews'
import type { DependencyCheckResult, DependencyInstallResult } from './dependencies'
import type { PreviewType } from '../file-type-registry'
import type { RemoteDirectoryStats, RemoteDirectoryUsageNode, RemoteEntryProperties } from './file-properties'
import type { AssistantEvent, AssistantRequest, AssistantRequests } from './assistant'

export interface RemoteFilesApi {
  assistant<R extends AssistantRequest>(request: R): Promise<AssistantRequests[R['action']]['output']>
  onAssistantEvent(callback: (event: AssistantEvent) => void): () => void
  getBootstrap(): Promise<AppBootstrap>
  onWindowExpanded(callback: (expanded: boolean) => void): () => void
  listProfiles(): Promise<ServerProfile[]>
  saveProfile(input: SaveProfileInput): Promise<ServerProfile>
  setProfilePinned(profileId: string, pinned: boolean): Promise<ServerProfile>
  deleteProfile(profileId: string): Promise<void>
  connect(sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string, rootSourceSessionId?: string): Promise<ConnectResult>
  trustHostKey(input: TrustHostKeyInput): Promise<void>
  disconnect(sessionId: string): Promise<void>
  enterFileRoot(sessionId: string, password?: string): Promise<FileElevationResult>
  cancelFileRootEntry(sessionId: string): Promise<void>
  leaveFileRoot(sessionId: string): Promise<FileRootExitResult>
  onFileRootExpired(callback: (event: FileRootExpiredEvent) => void): () => void
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  getPerformanceMonitorState(profileId: string): Promise<PerformanceMonitorState>
  setPerformanceMonitorEnabled(profileId: string, enabled: boolean): Promise<PerformanceMonitorState>
  refreshPerformanceMonitor(profileId: string): Promise<void>
  getAppSettings(): Promise<AppSettings>
  updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings>
  listCommandAliasSnapshots(): Promise<CommandAliasSnapshot[]>
  syncCommandAliases(profileId: string): Promise<CommandAliasOperationResult>
  saveCommandAlias(profileId: string, name: string, command: string, existingCommand?: string): Promise<CommandAliasOperationResult>
  deleteCommandAlias(profileId: string, name: string, expectedCommand: string): Promise<CommandAliasOperationResult>
  listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]>
  /**
   * Resolves the file browser destination for a remote path.
   * @param sessionId Connected file session.
   * @param remotePath Path to resolve from the remote root.
   * @returns The destination path and type.
   */
  resolveRemoteNavigationTarget(sessionId: string, remotePath: string): Promise<RemoteNavigationTarget>
  getRemoteEntryProperties(sessionId: string, remotePath: string): Promise<RemoteEntryProperties>
  getRemoteDirectoryStats(sessionId: string, remotePath: string): Promise<RemoteDirectoryStats>
  getRemoteDirectoryUsageTree(sessionId: string, remotePath: string, requestId: string): Promise<RemoteDirectoryUsageNode[]>
  cancelRemoteDirectoryUsageTree(requestId: string): Promise<boolean>
  startNameSearch(request: NameSearchRequest): Promise<string>
  cancelNameSearch(requestId: string): Promise<boolean>
  startContentSearch(request: ContentSearchRequest): Promise<string>
  cancelContentSearch(requestId: string): Promise<boolean>
  startScriptExecution(request: ScriptExecutionRequest): Promise<void>
  cancelScriptExecution(requestId: string): Promise<boolean>
  selectUploadSources(request: UploadSelectionRequest): Promise<UploadSelection | null>
  executeUpload(request: UploadExecutionRequest): Promise<TransferResult>
  cancelUploadSelection(selectionId: string): Promise<boolean>
  getPathForFile(file: File): string
  downloadEntries(requestId: string, sessionId: string, remotePaths: string[]): Promise<TransferResult>
  cancelTransfer(requestId: string): Promise<boolean>
  executeOperation(request: OperationExecutionRequest): Promise<OperationExecutionResult>
  cancelOperation(requestId: string): Promise<boolean>
  createRemoteDirectory(sessionId: string, remoteDirectory: string, name: string): Promise<void>
  renameRemoteEntry(sessionId: string, remotePath: string, name: string): Promise<string>
  copyRemotePath(sessionId: string, remotePath: string): Promise<void>
  deleteRemoteEntries(sessionId: string, remotePaths: string[]): Promise<void>
  previewFile(sessionId: string, remotePath: string, type: PreviewType, encoding?: TextEncoding): Promise<PreviewResult>
  openExternalUrl(url: string): Promise<void>
  saveTextFile(
    sessionId: string,
    remotePath: string,
    content: string,
    lineEnding: TextLineEnding,
    options: TextSaveOptions,
  ): Promise<TextSaveResult>
  installDependencies(id: string, password?: string): Promise<DependencyInstallResult>
  recheckDependencies(id: string): Promise<DependencyCheckResult>
  cancelDependencies(id: string): Promise<void>
  skipArchivePreparation(id: string): Promise<Extract<DependencyCheckResult, { status: 'ready' }>>
  readLogPreview(
    sessionId: string,
    remotePath: string,
    beforeOffset?: number,
    snapshotSize?: number,
  ): Promise<LogPreviewPage>
  releasePreview(token: string): Promise<void>
  onTransferProgress(callback: (progress: TransferProgress) => void): () => void
  onTransferQueued(callback: (event: TransferQueuedEvent) => void): () => void
  onNameSearchEvent(callback: (event: NameSearchEvent) => void): () => void
  onContentSearchEvent(callback: (event: ContentSearchEvent) => void): () => void
  onScriptExecutionEvent(callback: (event: ScriptExecutionEvent) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
  onTerminalOutput(callback: (event: TerminalOutputEvent) => void): () => void
  onPerformanceUpdate(callback: (event: PerformanceMonitorState) => void): () => void
}

export type RemoteFilesTransport = {
  [K in Exclude<keyof RemoteFilesApi, 'assistant'>]: RemoteFilesApi[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<IpcResult<R>>
    : RemoteFilesApi[K]
} & {
  assistant<R extends AssistantRequest>(request: R): Promise<IpcResult<AssistantRequests[R['action']]['output']>>
}
