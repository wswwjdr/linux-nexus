export interface ServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
}

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

export interface PreviewLimits {
  textMiB: number
  imageMiB: number
  audioMiB: number
  videoMiB: number
}

export interface TransferProgress {
  requestId: string
  profileId: string
  remotePath: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
}

export type TransferResult = 'completed' | 'not-started' | 'cancelled'

export type PreviewResult =
  | { type: 'text'; name: string; content: string }
  | { type: 'image' | 'audio' | 'video'; name: string; url: string; token: string }

export interface ConnectionClosedEvent {
  profileId: string
  message: string
}

export interface RemoteFilesApi {
  listProfiles(): Promise<ServerProfile[]>
  saveProfile(input: SaveProfileInput): Promise<ServerProfile>
  deleteProfile(profileId: string): Promise<void>
  connect(profileId: string): Promise<ConnectResult>
  trustHostKey(input: TrustHostKeyInput): Promise<void>
  disconnect(profileId: string): Promise<void>
  getPreviewLimits(): Promise<PreviewLimits>
  savePreviewLimits(limits: PreviewLimits): Promise<PreviewLimits>
  listDirectory(profileId: string, remotePath: string): Promise<RemoteEntry[]>
  searchFiles(request: RemoteSearchRequest): Promise<void>
  cancelSearch(requestId: string): Promise<boolean>
  uploadFiles(requestId: string, profileId: string, remoteDirectory: string): Promise<TransferResult>
  uploadFolder(requestId: string, profileId: string, remoteDirectory: string): Promise<TransferResult>
  downloadEntry(requestId: string, profileId: string, remotePath: string): Promise<TransferResult>
  cancelTransfer(requestId: string): Promise<boolean>
  copyRemotePath(profileId: string, remotePath: string): Promise<void>
  deleteRemoteEntry(profileId: string, remotePath: string): Promise<void>
  previewFile(profileId: string, remotePath: string): Promise<PreviewResult>
  releasePreview(token: string): Promise<void>
  onTransferProgress(callback: (progress: TransferProgress) => void): () => void
  onSearchEvent(callback: (event: RemoteSearchEvent) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
}
