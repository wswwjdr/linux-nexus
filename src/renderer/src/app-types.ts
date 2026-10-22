import type { CommandAlias, LogPreviewPage, PerformanceThresholds, PreviewExtensions, PreviewLimits, PreviewResult, RemoteEntry, ServerProfile, SessionKind, ThemeMode, TransferFailure, TransferFileProgress } from '@shared/types'

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
  fileCount?: number
  completedFiles: number
  failedFiles: number
  activeFiles: TransferFileProgress[]
  failures: TransferFailure[]
  state: 'starting' | 'queued' | 'running' | 'cancelling' | 'complete' | 'completed-with-errors' | 'cancelled'
}

export interface SessionTab {
  id: string
  profileId: string
  kind: SessionKind
  status: 'connecting' | 'connected' | 'disconnected' | 'awaiting-trust'
  currentPath: string
  startPath: string
  entries: RemoteEntry[]
  selectedPaths: string[]
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

export interface ContextMenuPosition {
  x: number
  y: number
}

export type BrowserContextMenu =
  | ({ kind: 'single-entry'; entry: RemoteEntry } & ContextMenuPosition)
  | ({ kind: 'multiple-entries'; entries: RemoteEntry[] } & ContextMenuPosition)
  | ({ kind: 'directory-background'; directory: string } & ContextMenuPosition)

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
  theme: ThemeMode
  previewExtensions: PreviewExtensions
  transferFileConcurrency: string
  performanceThresholds: Record<PerformanceThresholdField, string>
  defaultView: FileViewMode
  startupProfileId: string
  startupKind: SessionKind
}

export type PerformanceThresholdField = 'cpuWarning' | 'cpuCritical'
  | 'memoryWarning' | 'memoryCritical'
  | 'diskWarning' | 'diskCritical'
  | 'loadPerCoreWarning' | 'loadPerCoreCritical'
export type SettingsFieldKey = PreviewLimitKey | 'transferFileConcurrency' | PerformanceThresholdField
export type PerformanceThresholdFieldValues = Record<PerformanceThresholdField, string>

export function performanceThresholdsToForm(thresholds: PerformanceThresholds): PerformanceThresholdFieldValues {
  return {
    cpuWarning: String(thresholds.cpu.warning),
    cpuCritical: String(thresholds.cpu.critical),
    memoryWarning: String(thresholds.memory.warning),
    memoryCritical: String(thresholds.memory.critical),
    diskWarning: String(thresholds.disk.warning),
    diskCritical: String(thresholds.disk.critical),
    loadPerCoreWarning: String(thresholds.loadPerCore.warning),
    loadPerCoreCritical: String(thresholds.loadPerCore.critical),
  }
}
