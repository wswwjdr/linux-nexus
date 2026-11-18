import { type LanguagePreference, type SupportedLanguage } from '../i18n/languages'
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

export type ThemeMode = 'light' | 'dark' | 'cream'

export interface AppSettings {
  general: {
    language: LanguagePreference
    theme: ThemeMode
    startupConnection: StartupConnection | null
    sshCopyOnSelect: boolean
  }
  files: {
    defaultView: 'icons' | 'details'
    previewLimits: PreviewLimits
    fileTypeExtensions: FileTypeExtensions
    directoryUsageEntryLimit: number
  }
  transfers: { fileConcurrency: number }
  monitoring: { sampleIntervalSeconds: number; thresholds: PerformanceThresholds }
}

export type SettingsDomain = keyof AppSettings
export type AppSettingsUpdate = {
  [K in SettingsDomain]: { domain: K; value: AppSettings[K] }
}[SettingsDomain]

export interface AppBootstrap {
  settings: AppSettings
  systemLanguage: SupportedLanguage
  windowExpanded: boolean
}
