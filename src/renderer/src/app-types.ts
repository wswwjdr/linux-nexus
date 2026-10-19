import type { CommandAlias, LogPreviewPage, PreviewLimits, PreviewResult, RemoteEntry, ServerProfile, SessionKind } from '@shared/types'

export interface ProfileForm {
  id: string
  name: string
  host: string
  port: string
  username: string
  password: string
}

export interface PendingHostKey {
  sessionId: string
  profile: ServerProfile
  kind: SessionKind
  startPath: string
  fingerprint: string
  previousFingerprint?: string
}

export interface PendingAliasHostKey {
  profile: ServerProfile
  fingerprint: string
  previousFingerprint?: string
}

export interface CommandAliasConfirmation {
  alias: CommandAlias
  profileName: string
}

export interface TransferJob {
  sessionId: string
  profileName: string
  name: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  currentFileName?: string
  fileIndex?: number
  fileCount?: number
  fileTransferred?: number
  fileTotal?: number
  state: 'starting' | 'queued' | 'running' | 'cancelling' | 'complete' | 'cancelled'
}

export interface SessionTab {
  id: string
  profileId: string
  kind: SessionKind
  status: 'connecting' | 'connected' | 'disconnected' | 'awaiting-trust'
  currentPath: string
  startPath: string
  entries: RemoteEntry[]
  loading: boolean
  viewMode: FileViewMode
  sort: { column: SortColumn; direction: SortDirection }
  highlightedPath: string | null
  history: string[]
  historyIndex: number
  error: string | null
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

export type LogPreviewDialog =
  | { kind: 'loading'; name: string }
  | (LogPreviewPage & { kind: 'ready'; sessionId: string; path: string; loadingEarlier: boolean })

export type FileViewMode = 'icons' | 'details'
export type SortColumn = 'name' | 'size' | 'modifiedAt' | 'permissions' | 'type'
export type SortDirection = 'ascending' | 'descending'
export type PreviewLimitKey = keyof PreviewLimits
export type PreviewLimitsForm = Record<PreviewLimitKey, string>
export interface SettingsForm extends PreviewLimitsForm {
  defaultView: FileViewMode
  startupProfileId: string
  startupKind: SessionKind
}
