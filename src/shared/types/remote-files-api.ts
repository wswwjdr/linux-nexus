import type { RemoteEntry, SaveProfileInput, ServerProfile, CommandAliasOperationResult, CommandAliasSnapshot } from './profiles'
import type { NameSearchRequest, ContentSearchRequest, NameSearchEvent, ContentSearchEvent } from './search'
import type { ScriptExecutionRequest, ScriptExecutionEvent } from './script-executions'
import type { ConnectResult, TrustHostKeyInput, SessionKind, TerminalOutputEvent, ConnectionClosedEvent } from './sessions'
import type { PerformanceMonitorState } from './performance'
import type { AppSettings, AppSettingsPatch } from './settings'
import type { DroppedUploadEntry, TransferResult, OperationExecutionRequest, OperationExecutionResult, UploadSelectionRequest, UploadSelection, UploadExecutionRequest, TransferProgress, TransferQueuedEvent } from './transfers'
import type { PreviewResult, TextLineEnding, LogPreviewPage } from './previews'
import type { PreviewType } from '../file-type-registry'

export interface RemoteFilesApi {
  listProfiles(): Promise<ServerProfile[]>
  saveProfile(input: SaveProfileInput): Promise<ServerProfile>
  setProfilePinned(profileId: string, pinned: boolean): Promise<ServerProfile>
  deleteProfile(profileId: string): Promise<void>
  connect(sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string): Promise<ConnectResult>
  trustHostKey(input: TrustHostKeyInput): Promise<void>
  disconnect(sessionId: string): Promise<void>
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  getPerformanceMonitorState(sessionId: string): Promise<PerformanceMonitorState>
  activatePerformanceMonitor(sessionId: string): Promise<PerformanceMonitorState>
  deactivatePerformanceMonitor(sessionId: string): Promise<void>
  refreshPerformanceMonitor(sessionId: string): Promise<void>
  getAppSettings(): Promise<AppSettings>
  updateAppSettings(patch: AppSettingsPatch): Promise<AppSettings>
  listCommandAliasSnapshots(): Promise<CommandAliasSnapshot[]>
  syncCommandAliases(profileId: string): Promise<CommandAliasOperationResult>
  saveCommandAlias(profileId: string, name: string, command: string, existingCommand?: string): Promise<CommandAliasOperationResult>
  deleteCommandAlias(profileId: string, name: string, expectedCommand: string): Promise<CommandAliasOperationResult>
  listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]>
  startNameSearch(request: NameSearchRequest): Promise<void>
  cancelNameSearch(requestId: string): Promise<boolean>
  startContentSearch(request: ContentSearchRequest): Promise<void>
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
  copyRemotePath(sessionId: string, remotePath: string): Promise<void>
  deleteRemoteEntries(sessionId: string, remotePaths: string[]): Promise<void>
  previewFile(sessionId: string, remotePath: string, type: PreviewType): Promise<PreviewResult>
  openExternalUrl(url: string): Promise<void>
  saveTextFile(
    sessionId: string,
    remotePath: string,
    content: string,
    lineEnding: TextLineEnding,
  ): Promise<void>
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
