import type { AppSettings, PreviewExtensions, PreviewLimits, SessionKind, StartupConnection } from './types'
import { DEFAULT_PREVIEW_EXTENSIONS, normalizePreviewExtension, previewTypes } from './preview-file-type.ts'

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  textMiB: 5,
  pdfMiB: 100,
  imageMiB: 100,
  audioMiB: 100,
  videoMiB: 100,
}

export function defaultPreviewExtensions(): PreviewExtensions {
  return Object.fromEntries(previewTypes.map((type) => [type, [...DEFAULT_PREVIEW_EXTENSIONS[type]]])) as PreviewExtensions
}

export function defaultAppSettings(): AppSettings {
  return {
    ...DEFAULT_PREVIEW_LIMITS,
    previewExtensions: defaultPreviewExtensions(),
    startupConnection: null,
    transferFileConcurrency: 4,
  }
}

export const DEFAULT_APP_SETTINGS = defaultAppSettings()

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
  const settingsKeys = [...limitKeys, 'previewExtensions', 'startupConnection', 'transferFileConcurrency']
  if (!isRecord(value) || !hasExactKeys(value, settingsKeys)) throw new Error('应用设置结构无效')
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
  return { ...value as unknown as PreviewLimits, previewExtensions, startupConnection, transferFileConcurrency }
}

export function migrateAppSettings(value: unknown): { settings: AppSettings; migrated: boolean } {
  if (!isRecord(value)) return { settings: validateAppSettings(value), migrated: false }
  const defaults = defaultAppSettings()
  const migrated = Object.keys(defaults).some((key) => !Object.hasOwn(value, key))
  const settings = validateAppSettings(migrated ? { ...defaults, ...value } : value)
  return { settings, migrated }
}
