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
export type PasteStrategy = 'force' | 'skip'
export type OperationStrategy = OperationExecutionStrategy | 'confirm'

export interface OperationExecutionRequest {
  requestId: string
  sessionId: string
  operation: RemoteOperationKind
  sourcePaths: string[]
  targetDirectory: string
  strategy: OperationExecutionStrategy
  archivePath?: string
  wrapInDirectory?: boolean
}

export interface OperationExecutionResult {
  status: 'completed' | 'cancelled'
  requestId: string
  operation: RemoteOperationKind
  command: string
}

export type UploadSourceMode = 'files' | 'folder' | 'drop'

export interface UploadSelectionRequest {
  requestId: string
  sessionId: string
  remoteDirectory: string
  mode: UploadSourceMode
  entries?: DroppedUploadEntry[]
  strategy: OperationStrategy
}

export interface UploadSelectionItem {
  name: string
  type: 'file' | 'directory'
  size: number
}

export interface UploadSelection {
  selectionId: string
  requestId: string
  sessionId: string
  profileId: string
  remoteDirectory: string
  remoteRoot: string
  name: string
  strategy: OperationStrategy
  items: UploadSelectionItem[]
  failures: TransferFailure[]
  commandPreviews: Record<OperationExecutionStrategy, string>
}

export interface UploadExecutionRequest {
  selectionId: string
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
