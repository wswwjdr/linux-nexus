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

export interface DownloadProgress {
  requestId: string
  profileId: string
  remotePath: string
  transferred: number
  total: number
}

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
  listDirectory(profileId: string, remotePath: string): Promise<RemoteEntry[]>
  downloadFile(requestId: string, profileId: string, remotePath: string): Promise<boolean>
  onDownloadProgress(callback: (progress: DownloadProgress) => void): () => void
  onConnectionClosed(callback: (event: ConnectionClosedEvent) => void): () => void
}
