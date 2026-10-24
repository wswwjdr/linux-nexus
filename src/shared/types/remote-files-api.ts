import type { RemoteEntry, SaveProfileInput, ServerProfile, CommandAliasOperationResult, CommandAliasSnapshot } from './profiles'
import type { NameSearchRequest, ContentSearchRequest, NameSearchEvent, ContentSearchEvent } from './search'
import type { ScriptExecutionRequest, ScriptExecutionEvent } from './script-executions'
import type { ConnectResult, TrustHostKeyInput, SessionKind, TerminalOutputEvent, ConnectionClosedEvent } from './sessions'
import type { PerformanceMonitorState } from './performance'
import type { AppSettings, AppSettingsPatch } from './settings'
import type { DroppedUploadEntry, TransferResult, RemoteMoveRequest, RemoteMoveDecision, RemoteMoveResult, RemoteCopyRequest, RemoteCopyDecision, RemoteCopyResult, TransferProgress, TransferQueuedEvent, RemoteMoveEvent, RemoteCopyEvent } from './transfers'
import type { PreviewResult, TextFileRevision, TextFileSaveResult, LogPreviewPage } from './previews'
import type { PreviewType } from '../file-type-registry'

export interface RemoteFilesApi {
  listProfiles(): Promise<ServerProfile[]>
  saveProfile(input: SaveProfileInput): Promise<ServerProfile>
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
  saveCommandAlias(profileId: string, name: string, command: string, overwrite: boolean): Promise<CommandAliasOperationResult>
  deleteCommandAlias(profileId: string, name: string): Promise<CommandAliasOperationResult>
  listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]>
  startNameSearch(request: NameSearchRequest): Promise<void>
  cancelNameSearch(requestId: string): Promise<boolean>
  startContentSearch(request: ContentSearchRequest): Promise<void>
  cancelContentSearch(requestId: string): Promise<boolean>
  startScriptExecution(request: ScriptExecutionRequest): Promise<void>
  cancelScriptExecution(requestId: string): Promise<boolean>
  uploadFiles(requestId: string, sessionId: string, remoteDirectory: string): Promise<TransferResult>
  uploadFolder(requestId: string, sessionId: string, remoteDirectory: string): Promise<TransferResult>
  getPathForFile(file: File): string
  uploadDroppedEntries(
    requestId: string,
    sessionId: string,
    remoteDirectory: string,
    entries: DroppedUploadEntry[],
  ): Promise<TransferResult>
  downloadEntries(requestId: string, sessionId: string, remotePaths: string[]): Promise<TransferResult>
  cancelTransfer(requestId: string): Promise<boolean>
  moveRemoteEntries(request: RemoteMoveRequest): Promise<RemoteMoveResult>
  decideRemoteMove(requestId: string, conflictId: string, decision: RemoteMoveDecision): Promise<boolean>
  cancelRemoteMove(requestId: string): Promise<boolean>
  copyRemoteEntries(request: RemoteCopyRequest): Promise<RemoteCopyResult>
  decideRemoteCopy(requestId: string, conflictId: string, decision: RemoteCopyDecision): Promise<boolean>
  createRemoteDirectory(sessionId: string, remoteDirectory: string, name: string): Promise<void>
  copyRemotePath(sessionId: string, remotePath: string): Promise<void>
  deleteRemoteEntry(sessionId: string, remotePath: string): Promise<void>
  previewFile(sessionId: string, remotePath: string, type: PreviewType): Promise<PreviewResult>
  openExternalUrl(url: string): Promise<void>
  saveTextFile(
    sessionId: string,
    remotePath: string,
    content: string,
    expectedRevision: TextFileRevision,
  ): Promise<TextFileSaveResult>
  readLogPreview(
    sessionId: string,
    remotePath: string,
    beforeOffset?: number,
    snapshotSize?: number,
  ): Promise<LogPreviewPage>
  releasePreview(token: string): Promise<void>
  onTransferProgress(callback: (progress: TransferProgress) => void): () => void
  onTransferQueued(callback: (event: TransferQueuedEvent) => void): () => void
  onRemoteMoveEvent(callback: (event: RemoteMoveEvent) => void): () => void
  onRemoteCopyEvent(callback: (event: RemoteCopyEvent) => void): () => void
  onNameSearchEvent(callback: (event: NameSearchEvent) => void): () => void
  onContentSearchEvent(callback: (event: ContentSearchEvent) => void): () => void
  onScriptExecutionEvent(callback: (event: ScriptExecutionEvent) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
  onTerminalOutput(callback: (event: TerminalOutputEvent) => void): () => void
  onPerformanceUpdate(callback: (event: PerformanceMonitorState) => void): () => void
}
