export type RemoteArchiveFormat =
  | 'zip'
  | 'tar'
  | 'tar-gz'
  | 'tar-bz2'
  | 'tar-xz'
  | 'tar-zst'

export type RemoteArchiveDecision =
  | 'replace'
  | 'skip'
  | 'rename'
  | 'replace-all'
  | 'skip-all'
  | 'rename-all'
  | 'cancel'

export interface RemoteArchiveRequest {
  requestId: string
  sessionId: string
  archivePath: string
  targetDirectory: string
  wrapInDirectory: boolean
}

export interface RemoteArchiveConflict {
  requestId: string
  conflictId: string
  sessionId: string
  archivePath: string
  memberPath: string
  targetPath: string
  sourceType: 'file' | 'directory'
  targetType: 'file' | 'directory' | 'symlink' | 'other'
  conflictType: 'file' | 'type-mismatch'
}

export interface RemoteArchiveProgress {
  requestId: string
  sessionId: string
  phase: 'preparing' | 'extracting' | 'merging'
  completedCount: number
  totalCount: number
  currentPath: string | null
}

export interface RemoteArchiveItemResult {
  path: string
  status: 'skipped' | 'failed'
  message?: string
}

export interface RemoteArchiveResult {
  status: 'completed' | 'cancelled'
  outputDirectory: string
  extractedCount: number
  skippedCount: number
  failedCount: number
  cancelledCount: number
  results: RemoteArchiveItemResult[]
}

export type RemoteArchiveEvent =
  | { type: 'conflict'; conflict: RemoteArchiveConflict }
  | { type: 'progress'; progress: RemoteArchiveProgress }

const archiveSuffixes: readonly { suffix: string; format: RemoteArchiveFormat }[] = [
  { suffix: '.tar.bz2', format: 'tar-bz2' },
  { suffix: '.tar.gz', format: 'tar-gz' },
  { suffix: '.tar.xz', format: 'tar-xz' },
  { suffix: '.tar.zst', format: 'tar-zst' },
  { suffix: '.tbz2', format: 'tar-bz2' },
  { suffix: '.tgz', format: 'tar-gz' },
  { suffix: '.txz', format: 'tar-xz' },
  { suffix: '.tzst', format: 'tar-zst' },
  { suffix: '.tar', format: 'tar' },
  { suffix: '.zip', format: 'zip' },
]

export function archiveFormatForName(name: string): RemoteArchiveFormat | null {
  const lowerName = name.toLowerCase()
  return archiveSuffixes.find(({ suffix }) => lowerName.endsWith(suffix))?.format ?? null
}

export function archiveBaseName(name: string): string {
  const lowerName = name.toLowerCase()
  const match = archiveSuffixes.find(({ suffix }) => lowerName.endsWith(suffix))
  if (!match) throw new Error('不支持的压缩包格式')
  return name.slice(0, -match.suffix.length) || 'extracted'
}
