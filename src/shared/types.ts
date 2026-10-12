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
  uploadFiles(requestId: string, profileId: string, remoteDirectory: string): Promise<boolean>
  uploadFolder(requestId: string, profileId: string, remoteDirectory: string): Promise<boolean>
  downloadEntry(requestId: string, profileId: string, remotePath: string): Promise<boolean>
  previewFile(profileId: string, remotePath: string): Promise<PreviewResult>
  releasePreview(token: string): Promise<void>
  onTransferProgress(callback: (progress: TransferProgress) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
}
