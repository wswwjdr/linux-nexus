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

export type RemoteOperationKind = 'copy' | 'move' | 'extract'
export type OperationExecutionStrategy = 'force' | 'skip' | 'update'
export type OperationStrategy = OperationExecutionStrategy | 'confirm'
export type ArchiveDependency = 'unzip' | 'gzip' | 'bzip2' | 'xz' | 'zstd'

export interface OperationConflict {
  sourcePath: string
  targetPath: string
  sourceType: 'file' | 'directory'
  targetType: 'file' | 'directory' | 'symlink' | 'other'
}

export interface OperationPreflightRequest {
  requestId: string
  sessionId: string
  operation: RemoteOperationKind
  sourcePaths: string[]
  targetDirectory: string
  strategy: OperationStrategy
  archivePath?: string
  wrapInDirectory?: boolean
}

export interface OperationPreflight {
  preflightId: string
  sessionId: string
  operation: RemoteOperationKind
  sourcePaths: string[]
  targetDirectory: string
  strategy: OperationStrategy
  conflicts: OperationConflict[]
  commandPreviews: Record<OperationExecutionStrategy, string>
  archivePath?: string
  outputDirectory?: string
  missingDependencies?: ArchiveDependency[]
}

export interface OperationExecutionRequest {
  preflightId: string
  strategy: OperationExecutionStrategy
}

export interface OperationExecutionResult {
  status: 'completed' | 'cancelled'
  operation: RemoteOperationKind
  command: string
}

export type UploadSourceMode = 'files' | 'folder' | 'drop'

export interface UploadPreflightRequest {
  requestId: string
  sessionId: string
  remoteDirectory: string
  mode: UploadSourceMode
  entries?: DroppedUploadEntry[]
  strategy: OperationStrategy
}

export interface UploadPreflightItem {
  name: string
  type: 'file' | 'directory'
  size: number
}

export interface UploadPreflight {
  preflightId: string
  requestId: string
  sessionId: string
  profileId: string
  remoteDirectory: string
  remoteRoot: string
  name: string
  strategy: OperationStrategy
  items: UploadPreflightItem[]
  conflicts: OperationConflict[]
  failures: TransferFailure[]
  commandPreviews: Record<OperationExecutionStrategy, string>
}

export interface UploadExecutionRequest {
  preflightId: string
  strategy: OperationExecutionStrategy
}

export type TransferResult =
  | { status: 'completed' }
  | { status: 'completed-with-errors'; failures: TransferFailure[] }
  | { status: 'not-started' }
  | { status: 'cancelled' }

export type DroppedUploadEntry =
  | { relativePath: string; type: 'directory' }
  | { relativePath: string; type: 'file'; localPath: string }
