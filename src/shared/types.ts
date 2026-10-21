export interface ServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
}

export interface CommandAlias {
  name: string
  command: string
  removable: boolean
  removalReason: string | null
}

export interface CommandAliasSnapshot {
  profileId: string
  aliases: CommandAlias[]
  syncedAt: string | null
  status: 'unsynced' | 'synced' | 'stale'
}

export type CommandAliasOperationResult =
  | { status: 'completed'; snapshot: CommandAliasSnapshot }
  | { status: 'host-key-required'; fingerprint: string; previousFingerprint?: string }
  | { status: 'conflict'; name: string; existingCommand: string }
  | { status: 'updated-sync-failed'; message: string; snapshot: CommandAliasSnapshot }

export interface SaveProfileInput {
  profile: ServerProfile
  password?: string
}

export interface RemoteEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modifiedAt: string | null
  permissions: string
}

export type RemoteSearchMode = 'name' | 'content'
export type RemoteSearchMatcher = 'literal' | 'regex'
export type RemoteSearchScope = 'current' | 'root'

export interface RemoteSearchRequest {
  requestId: string
  sessionId: string
  profileId: string
  query: string
  mode: RemoteSearchMode
  matcher: RemoteSearchMatcher
  scope: RemoteSearchScope
  rootPath: string
  maxFileSizeMiB: number
  includeSystemPaths: boolean
  includeMountedFilesystems: boolean
}

export interface RemoteSearchLineMatch {
  lineNumber: number
  before?: { lineNumber: number; text: string }
  text: string
  after?: { lineNumber: number; text: string }
}

export interface RemoteSearchResult {
  name: string
  path: string
  type: RemoteEntry['type']
  size: number
  matches: RemoteSearchLineMatch[]
}

export interface RemoteSearchProgress {
  requestId: string
  sessionId: string
  profileId: string
  scannedEntries: number
  matchedFiles: number
  matchedLines: number
  skippedEntries: number
  incomplete: boolean
}

export type RemoteSearchEvent =
  | ({ type: 'progress' } & RemoteSearchProgress)
  | ({ type: 'results'; results: RemoteSearchResult[] } & RemoteSearchProgress)
  | ({ type: 'finished'; status: 'completed' | 'cancelled' | 'failed'; message?: string } & RemoteSearchProgress)

export type ConnectResult =
  | { ok: true; path: string }
  | {
      ok: false
      reason: 'host-key-unknown'
      fingerprint: string
    }
  | {
      ok: false
      reason: 'host-key-changed'
      fingerprint: string
      previousFingerprint: string
    }
  | {
      ok: false
      reason: 'auth-failed' | 'unreachable' | 'sftp-unavailable' | 'other'
      message: string
    }

export interface TrustHostKeyInput {
  profileId: string
  fingerprint: string
  previousFingerprint?: string
}

export type SessionKind = 'sftp' | 'terminal'

export interface TerminalOutputEvent {
  sessionId: string
  data: string
}

export interface PreviewLimits {
  textMiB: number
  pdfMiB: number
  imageMiB: number
  audioMiB: number
  videoMiB: number
}

export type PreviewType = 'text' | 'markdown' | 'pdf' | 'image' | 'audio' | 'video'

export type PreviewExtensions = Record<PreviewType, string[]>

export interface StartupConnection {
  profileId: string
  kind: SessionKind
}

export interface AppSettings extends PreviewLimits {
  previewExtensions: PreviewExtensions
  startupConnection: StartupConnection | null
  transferFileConcurrency: number
}

export interface TransferFileProgress {
  remotePath: string
  transferred: number
  total: number
}

export interface TransferFailure {
  path: string
  message: string
}

export interface TransferProgress {
  requestId: string
  sessionId: string
  profileId: string
  remotePath: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  fileCount: number
  completedFiles: number
  failedFiles: number
  activeFiles: TransferFileProgress[]
}

export interface TransferQueuedEvent {
  requestId: string
}

export interface RemoteMoveRequest {
  requestId: string
  sessionId: string
  currentDirectory: string
  sourcePaths: string[]
  targetDirectory: string
}

export type RemoteMoveDecision = 'replace' | 'skip' | 'replace-all' | 'skip-all' | 'cancel'

export interface RemoteMoveConflict {
  requestId: string
  conflictId: string
  sessionId: string
  sourcePath: string
  targetPath: string
  sourceName: string
  targetName: string
  sourceType: 'file' | 'directory'
  targetType: 'file' | 'directory'
  conflictType: 'file' | 'type-mismatch'
}

export interface RemoteMoveProgress {
  requestId: string
  sessionId: string
  completedCount: number
  totalCount: number
  currentPath: string | null
}

export type RemoteMoveEvent =
  | { type: 'conflict'; conflict: RemoteMoveConflict }
  | { type: 'progress'; progress: RemoteMoveProgress }

export interface RemoteMoveItemResult {
  sourcePath: string
  sourceName: string
  status: 'moved' | 'skipped' | 'failed' | 'cancelled'
  message?: string
}

export interface RemoteMoveResult {
  status: 'completed' | 'cancelled'
  results: RemoteMoveItemResult[]
  movedCount: number
  skippedCount: number
  failedCount: number
  cancelledCount: number
}

export interface RemoteCopyRequest {
  requestId: string
  sessionId: string
  sourcePaths: string[]
  targetDirectory: string
}

export type RemoteCopyDecision = RemoteMoveDecision
export type RemoteCopyConflict = RemoteMoveConflict

export interface RemoteCopyItemResult {
  sourcePath: string
  sourceName: string
  status: 'copied' | 'skipped' | 'failed' | 'cancelled'
  message?: string
}

export interface RemoteCopyResult {
  status: 'completed' | 'cancelled'
  results: RemoteCopyItemResult[]
  copiedCount: number
  skippedCount: number
  failedCount: number
  cancelledCount: number
}

export type RemoteCopyEvent = { type: 'conflict'; conflict: RemoteCopyConflict }

export type TransferResult =
  | { status: 'completed' }
  | { status: 'completed-with-errors'; failures: TransferFailure[] }
  | { status: 'not-started' }
  | { status: 'cancelled' }

export type DroppedUploadEntry =
  | { relativePath: string; type: 'directory' }
  | { relativePath: string; type: 'file'; localPath: string }

export type TextLineEnding = '\n' | '\r\n' | '\r' | null

export interface TextFileRevision {
  contentHash: string
  lineEnding: TextLineEnding
}

export interface TextFileSaveResult {
  revision: TextFileRevision
  backupPath?: string
}

export type PreviewResult =
  | { type: 'text'; name: string; content: string; revision: TextFileRevision }
  | { type: 'markdown'; name: string; content: string }
  | { type: 'pdf'; name: string; url: string; token: string }
  | { type: 'image'; name: string; url: string; token: string }
  | { type: 'audio'; name: string; url: string; token: string }
  | { type: 'video'; name: string; url: string; token: string }

export interface LogPreviewPage {
  name: string
  content: string
  startOffset: number
  fileSize: number
  limitBytes: number
  hasEarlier: boolean
}

export interface ConnectionClosedEvent {
  sessionId: string
  profileId: string
  message: string
}

export interface RemoteFilesApi {
  listProfiles(): Promise<ServerProfile[]>
  saveProfile(input: SaveProfileInput): Promise<ServerProfile>
  deleteProfile(profileId: string): Promise<void>
  connect(sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string): Promise<ConnectResult>
  trustHostKey(input: TrustHostKeyInput): Promise<void>
  disconnect(sessionId: string): Promise<void>
  writeTerminal(sessionId: string, data: string): Promise<void>
  resizeTerminal(sessionId: string, cols: number, rows: number): Promise<void>
  getAppSettings(): Promise<AppSettings>
  saveAppSettings(settings: AppSettings): Promise<AppSettings>
  listCommandAliasSnapshots(): Promise<CommandAliasSnapshot[]>
  syncCommandAliases(profileId: string): Promise<CommandAliasOperationResult>
  saveCommandAlias(profileId: string, name: string, command: string, overwrite: boolean): Promise<CommandAliasOperationResult>
  deleteCommandAlias(profileId: string, name: string): Promise<CommandAliasOperationResult>
  listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]>
  searchFiles(request: RemoteSearchRequest): Promise<void>
  cancelSearch(requestId: string): Promise<boolean>
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
  onSearchEvent(callback: (event: RemoteSearchEvent) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
  onTerminalOutput(callback: (event: TerminalOutputEvent) => void): () => void
}
