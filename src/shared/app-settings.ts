import type { AppSettings, PerformanceThresholds, PreviewExtensions, PreviewLimits, SessionKind, StartupConnection } from './types'
import { DEFAULT_PREVIEW_EXTENSIONS, normalizePreviewExtension, previewTypes } from './preview-file-type.ts'

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

export function defaultPreviewExtensions(): PreviewExtensions {
  return Object.fromEntries(previewTypes.map((type) => [type, [...DEFAULT_PREVIEW_EXTENSIONS[type]]])) as PreviewExtensions
}

export function defaultAppSettings(): AppSettings {
  return {
    ...DEFAULT_PREVIEW_LIMITS,
    theme: 'light',
    defaultView: 'details',
    previewExtensions: defaultPreviewExtensions(),
    startupConnection: null,
    transferFileConcurrency: 4,
    performanceThresholds: {
      cpu: { ...DEFAULT_PERFORMANCE_THRESHOLDS.cpu },
      memory: { ...DEFAULT_PERFORMANCE_THRESHOLDS.memory },
      disk: { ...DEFAULT_PERFORMANCE_THRESHOLDS.disk },
      loadPerCore: { ...DEFAULT_PERFORMANCE_THRESHOLDS.loadPerCore },
    },
  }
}

export const DEFAULT_APP_SETTINGS = defaultAppSettings()
const legacyAppSettingsKeys = [...Object.keys(DEFAULT_PREVIEW_LIMITS), 'theme', 'defaultView', 'previewExtensions', 'startupConnection', 'transferFileConcurrency']
const appSettingsKeys = [...legacyAppSettingsKeys, 'performanceThresholds']
const performanceThresholdKeys = ['cpu', 'memory', 'disk', 'loadPerCore'] as const

const MAX_PREVIEW_LIMIT_MIB = 1024
const MIN_TRANSFER_FILE_CONCURRENCY = 1
const MAX_TRANSFER_FILE_CONCURRENCY = 16

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function validateAppSettings(value: unknown): AppSettings {
  const limitKeys = Object.keys(DEFAULT_PREVIEW_LIMITS)
  if (!isRecord(value) || !hasExactKeys(value, appSettingsKeys)) throw new Error('应用设置结构无效')
  if (value.theme !== 'light' && value.theme !== 'dark' && value.theme !== 'system') {
    throw new Error('外观主题设置无效')
  }
  if (value.defaultView !== 'icons' && value.defaultView !== 'details') throw new Error('默认文件视图设置无效')
  for (const key of limitKeys) {
    const limit = value[key]
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PREVIEW_LIMIT_MIB) {
      throw new Error('预览设置 ' + key + ' 必须是 1 到 ' + MAX_PREVIEW_LIMIT_MIB + ' 之间的整数')
    }
  }
  const transferFileConcurrency = value.transferFileConcurrency
  if (typeof transferFileConcurrency !== 'number' || !Number.isInteger(transferFileConcurrency)
    || transferFileConcurrency < MIN_TRANSFER_FILE_CONCURRENCY || transferFileConcurrency > MAX_TRANSFER_FILE_CONCURRENCY) {
    throw new Error('同时传输文件数必须是 1 到 16 之间的整数')
  }
  const configuredThresholds = value.performanceThresholds
  if (!isRecord(configuredThresholds) || !hasExactKeys(configuredThresholds, [...performanceThresholdKeys])) {
    throw new Error('性能监控阈值结构无效')
  }
  const performanceThresholds = Object.fromEntries(performanceThresholdKeys.map((key) => {
    const configured = configuredThresholds[key]
    if (!isRecord(configured) || !hasExactKeys(configured, ['warning', 'critical'])) {
      throw new Error('性能监控阈值结构无效：' + key)
    }
    const { warning, critical } = configured
    if (typeof warning !== 'number' || !Number.isFinite(warning) || warning < 0 || warning > 100
      || typeof critical !== 'number' || !Number.isFinite(critical) || critical < 0 || critical > 100
      || warning >= critical) {
      throw new Error('性能监控阈值无效：' + key + ' 的注意值必须小于严重值，且均须在 0 到 100 之间')
    }
    return [key, { warning, critical }]
  })) as unknown as PerformanceThresholds
  const configuredExtensions = value.previewExtensions
  if (!isRecord(configuredExtensions) || !hasExactKeys(configuredExtensions, [...previewTypes])) {
    throw new Error('预览格式设置结构无效')
  }
  const previewExtensions = Object.fromEntries(previewTypes.map((type) => {
    const extensions = configuredExtensions[type]
    if (!Array.isArray(extensions) || extensions.some((extension) => typeof extension !== 'string')) {
      throw new Error('预览格式设置无效：' + type)
    }
    return [type, [...new Set(extensions.map((extension) => normalizePreviewExtension(extension as string)))]]
  })) as PreviewExtensions
  let startupConnection: StartupConnection | null = null
  if (value.startupConnection !== null) {
    const connection = value.startupConnection
    if (!isRecord(connection) || !hasExactKeys(connection, ['profileId', 'kind'])
      || typeof connection.profileId !== 'string' || !connection.profileId
      || (connection.kind !== 'sftp' && connection.kind !== 'terminal')) {
      throw new Error('启动连接设置无效')
    }
    startupConnection = { profileId: connection.profileId, kind: connection.kind as SessionKind }
  }
  return {
    ...value as unknown as PreviewLimits,
    theme: value.theme,
    defaultView: value.defaultView,
    previewExtensions,
    startupConnection,
    transferFileConcurrency,
    performanceThresholds,
  }
}

export function upgradeAppSettings(value: unknown): { settings: AppSettings; migrated: boolean } {
  if (isRecord(value) && hasExactKeys(value, legacyAppSettingsKeys)) {
    return {
      settings: validateAppSettings({ ...value, performanceThresholds: DEFAULT_PERFORMANCE_THRESHOLDS }),
      migrated: true,
    }
  }
  return { settings: validateAppSettings(value), migrated: false }
}

export function applyAppSettingsPatch(current: AppSettings, patch: unknown): AppSettings {
  if (!isRecord(patch) || Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !appSettingsKeys.includes(key))) {
    throw new Error('应用设置更新无效')
  }
  return validateAppSettings({ ...current, ...patch })
}
