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
  sourcePaths: string[]
  targetDirectory: string
}

export type RemoteMoveDecision = 'replace' | 'skip' | 'rename' | 'replace-all' | 'skip-all' | 'rename-all' | 'cancel'

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
