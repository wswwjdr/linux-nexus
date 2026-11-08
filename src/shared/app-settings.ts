import { isLanguagePreference } from './i18n/languages'
import { msg, LocalizedError } from './i18n/messages'
import type { AppSettings, PerformanceThresholds, FileTypeExtensions, PreviewLimits, SessionKind, StartupConnection } from './types'
import { DEFAULT_FILE_TYPE_EXTENSIONS, fileTypeRegistry, normalizeFileTypeExtension } from './file-type-registry'

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  textMiB: 5,
  pdfMiB: 100,
  imageMiB: 100,
  audioMiB: 100,
  videoMiB: 100,
}

export const DEFAULT_PERFORMANCE_THRESHOLDS: PerformanceThresholds = {
  cpu: { warning: 75, critical: 90 },
  memory: { warning: 75, critical: 90 },
  disk: { warning: 80, critical: 90 },
  loadPerCore: { warning: 1, critical: 2 },
}

export function defaultFileTypeExtensions(): FileTypeExtensions {
  return Object.fromEntries(fileTypeRegistry.map(({ id }) => [
    id,
    DEFAULT_FILE_TYPE_EXTENSIONS[id].map(normalizeFileTypeExtension),
  ])) as FileTypeExtensions
}

export function defaultAppSettings(): AppSettings {
  return {
    ...DEFAULT_PREVIEW_LIMITS,
    language: 'system',
    theme: 'light',
    defaultView: 'details',
    fileTypeExtensions: defaultFileTypeExtensions(),
    startupConnection: null,
    transferFileConcurrency: 4,
    performanceSampleIntervalSeconds: 3,
    performanceThresholds: {
      cpu: { ...DEFAULT_PERFORMANCE_THRESHOLDS.cpu },
      memory: { ...DEFAULT_PERFORMANCE_THRESHOLDS.memory },
      disk: { ...DEFAULT_PERFORMANCE_THRESHOLDS.disk },
      loadPerCore: { ...DEFAULT_PERFORMANCE_THRESHOLDS.loadPerCore },
    },
  }
}

export const DEFAULT_APP_SETTINGS = defaultAppSettings()
const appSettingsKeys = [...Object.keys(DEFAULT_PREVIEW_LIMITS), 'language', 'theme', 'defaultView', 'fileTypeExtensions', 'startupConnection', 'transferFileConcurrency', 'performanceSampleIntervalSeconds', 'performanceThresholds']
const performanceThresholdKeys = ['cpu', 'memory', 'disk', 'loadPerCore'] as const

const MIN_TRANSFER_FILE_CONCURRENCY = 1
const MAX_TRANSFER_FILE_CONCURRENCY = 16
const MIN_PERFORMANCE_SAMPLE_INTERVAL_SECONDS = 1
const MAX_PERFORMANCE_SAMPLE_INTERVAL_SECONDS = 300

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function validateAppSettings(value: unknown): AppSettings {
  const limitKeys = Object.keys(DEFAULT_PREVIEW_LIMITS)
  if (!isRecord(value) || !hasExactKeys(value, appSettingsKeys)) throw new LocalizedError(msg('errors.invalidApplicationSettingsStructure'))
  if (!isLanguagePreference(value.language)) throw new LocalizedError(msg('settings.invalidLanguage'))
  if (value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'cream') {
    throw new LocalizedError(msg('errors.invalidAppearanceThemeSetting'))
  }
  if (value.defaultView !== 'icons' && value.defaultView !== 'details') throw new LocalizedError(msg('errors.invalidDefaultFileViewSetting'))
  for (const key of limitKeys) {
    const limit = value[key]
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
      throw new LocalizedError(msg('errors.previewSettingMustBeAPositiveInteger', { "key": key }))
    }
  }
  const transferFileConcurrency = value.transferFileConcurrency
  if (typeof transferFileConcurrency !== 'number' || !Number.isInteger(transferFileConcurrency)
    || transferFileConcurrency < MIN_TRANSFER_FILE_CONCURRENCY || transferFileConcurrency > MAX_TRANSFER_FILE_CONCURRENCY) {
    throw new LocalizedError(msg('errors.concurrentFileTransfersMustBeAnIntegerFrom1To'))
  }
  const performanceSampleIntervalSeconds = value.performanceSampleIntervalSeconds
  if (typeof performanceSampleIntervalSeconds !== 'number' || !Number.isInteger(performanceSampleIntervalSeconds)
    || performanceSampleIntervalSeconds < MIN_PERFORMANCE_SAMPLE_INTERVAL_SECONDS
    || performanceSampleIntervalSeconds > MAX_PERFORMANCE_SAMPLE_INTERVAL_SECONDS) {
    throw new LocalizedError(msg('errors.performanceSamplingIntervalMustBeAnIntegerFrom1To'))
  }
  const configuredThresholds = value.performanceThresholds
  if (!isRecord(configuredThresholds) || !hasExactKeys(configuredThresholds, [...performanceThresholdKeys])) {
    throw new LocalizedError(msg('errors.invalidPerformanceThresholdStructure'))
  }
  const performanceThresholds = Object.fromEntries(performanceThresholdKeys.map((key) => {
    const configured = configuredThresholds[key]
    if (!isRecord(configured) || !hasExactKeys(configured, ['warning', 'critical'])) {
      throw new LocalizedError(msg('errors.invalidPerformanceThresholdStructure2', { "key": key }))
    }
    const { warning, critical } = configured
    if (typeof warning !== 'number' || !Number.isFinite(warning) || warning < 0 || warning > 100
      || typeof critical !== 'number' || !Number.isFinite(critical) || critical < 0 || critical > 100
      || warning >= critical) {
      throw new LocalizedError(msg('errors.invalidPerformanceThresholdsWarningMustBeBelowCriticalAndBoth', { "key": key }))
    }
    return [key, { warning, critical }]
  })) as unknown as PerformanceThresholds
  const configuredExtensions = value.fileTypeExtensions
  if (!isRecord(configuredExtensions) || !hasExactKeys(configuredExtensions, fileTypeRegistry.map(({ id }) => id))) {
    throw new LocalizedError(msg('errors.invalidFileTypeCategorySettingsStructure'))
  }
  const fileTypeExtensions = Object.fromEntries(fileTypeRegistry.map(({ id: category }) => {
    const extensions = configuredExtensions[category]
    if (!Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string')) {
      throw new LocalizedError(msg('errors.invalidFileTypeCategorySetting', { "category": category }))
    }
    return [category, [...new Set(extensions.map((extension) => normalizeFileTypeExtension(extension as string)))]]
  })) as FileTypeExtensions
  let startupConnection: StartupConnection | null = null
  if (value.startupConnection !== null) {
    const connection = value.startupConnection
    if (!isRecord(connection) || !hasExactKeys(connection, ['profileId', 'kind'])
      || typeof connection.profileId !== 'string' || !connection.profileId
      || (connection.kind !== 'files' && connection.kind !== 'terminal')) {
      throw new LocalizedError(msg('errors.invalidStartupConnectionSetting'))
    }
    startupConnection = { profileId: connection.profileId, kind: connection.kind as SessionKind }
  }
  return {
    ...value as unknown as PreviewLimits,
    language: value.language,
    theme: value.theme,
    defaultView: value.defaultView,
    fileTypeExtensions,
    startupConnection,
    transferFileConcurrency,
    performanceSampleIntervalSeconds,
    performanceThresholds,
  }
}

export function applyAppSettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  if (!isRecord(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !appSettingsKeys.includes(key))) {
    throw new LocalizedError(msg('errors.invalidApplicationSettingsUpdate'))
  }
  return validateAppSettings({ ...current, ...patch })
}
