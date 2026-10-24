import type { FileTypeExtensions } from '../file-type-registry'
import type { PerformanceThresholds } from './performance'
import type { SessionKind } from './sessions'

export interface PreviewLimits {
  textMiB: number
  pdfMiB: number
  imageMiB: number
  audioMiB: number
  videoMiB: number
}

export interface StartupConnection {
  profileId: string
  kind: SessionKind
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface AppSettings extends PreviewLimits {
  theme: ThemeMode
  defaultView: 'icons' | 'details'
  fileTypeExtensions: FileTypeExtensions
  startupConnection: StartupConnection | null
  transferFileConcurrency: number
  performanceSampleIntervalSeconds: number
  performanceThresholds: PerformanceThresholds
}

export type AppSettingsPatch = Partial<AppSettings>
