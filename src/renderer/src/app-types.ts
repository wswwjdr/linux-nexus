import type { PreviewLimits, PreviewResult, RemoteEntry, ServerProfile } from '@shared/types'

export interface ProfileForm {
  id: string
  name: string
  host: string
  port: string
  username: string
  password: string
}

export interface PendingHostKey {
  profile: ServerProfile
  fingerprint: string
  previousFingerprint?: string
}

export interface TransferJob {
  name: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  state: 'starting' | 'running' | 'cancelling' | 'complete' | 'cancelled'
}

export interface ImagePreviewSize {
  width: number
  height: number
}

export interface RecentConnection {
  profileId: string
  connectedAt: number
}

export type BrowserContextMenu =
  | { kind: 'entry'; entry: RemoteEntry; x: number; y: number }
  | { kind: 'directory'; x: number; y: number }

export type PreviewDialog =
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; result: PreviewResult }

export type FileViewMode = 'icons' | 'details'
export type SortColumn = 'name' | 'size' | 'modifiedAt' | 'permissions'
export type SortDirection = 'ascending' | 'descending'
export type PreviewLimitKey = keyof PreviewLimits
export type PreviewLimitsForm = Record<PreviewLimitKey, string>
export interface SettingsForm extends PreviewLimitsForm {
  defaultView: FileViewMode
}
