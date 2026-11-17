import { z } from 'zod'
import { msg, LocalizedError } from './i18n/messages'
import type { AppSettings, AppSettingsUpdate, PerformanceThresholds, FileTypeExtensions, PreviewLimits } from './types'
import { DEFAULT_FILE_TYPE_EXTENSIONS, fileTypeRegistry, normalizeFileTypeExtension } from './file-type-registry'

export const DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT = 100_000
export const MAX_DIRECTORY_USAGE_ENTRY_LIMIT = 500_000

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

/** Creates independent normalized extension lists. @returns Default extensions for every category. */
export function defaultFileTypeExtensions(): FileTypeExtensions {
  return Object.fromEntries(
    fileTypeRegistry.map(({ id }) => [id, DEFAULT_FILE_TYPE_EXTENSIONS[id].map(normalizeFileTypeExtension)]),
  ) as FileTypeExtensions
}

const positiveInteger = z.int().min(1)
const threshold = z
  .strictObject({ warning: z.number().min(0).max(100), critical: z.number().min(0).max(100) })
  .refine((value) => value.warning < value.critical)
const extensions = z.array(z.string()).transform((values) => [...new Set(values.map(normalizeFileTypeExtension))])

export const settingsDomains = {
  general: z.strictObject({
    language: z.enum(['system', 'zh-CN', 'en']),
    theme: z.enum(['light', 'dark', 'cream']),
    startupConnection: z.strictObject({ profileId: z.string().min(1), kind: z.enum(['files', 'terminal']) }).nullable(),
  }),
  files: z.strictObject({
    defaultView: z.enum(['icons', 'details']),
    previewLimits: z.strictObject({
      textMiB: positiveInteger,
      pdfMiB: positiveInteger,
      imageMiB: positiveInteger,
      audioMiB: positiveInteger,
      videoMiB: positiveInteger,
    }),
    fileTypeExtensions: z.strictObject(
      Object.fromEntries(fileTypeRegistry.map(({ id }) => [id, extensions])) as Record<
        keyof FileTypeExtensions,
        typeof extensions
      >,
    ),
    directoryUsageEntryLimit: positiveInteger.max(MAX_DIRECTORY_USAGE_ENTRY_LIMIT),
  }),
  transfers: z.strictObject({ fileConcurrency: positiveInteger.max(16) }),
  monitoring: z.strictObject({
    sampleIntervalSeconds: positiveInteger.max(300),
    thresholds: z.strictObject({ cpu: threshold, memory: threshold, disk: threshold, loadPerCore: threshold }),
  }),
}
export const appSettingsSchema = z.strictObject(settingsDomains)
export const appSettingsUpdateSchema = z.discriminatedUnion('domain', [
  z.strictObject({ domain: z.literal('general'), value: settingsDomains.general }),
  z.strictObject({ domain: z.literal('files'), value: settingsDomains.files }),
  z.strictObject({ domain: z.literal('transfers'), value: settingsDomains.transfers }),
  z.strictObject({ domain: z.literal('monitoring'), value: settingsDomains.monitoring }),
])

/** Creates independent defaults for every application settings domain. @returns Fresh settings. */
export function defaultAppSettings(): AppSettings {
  return {
    general: { language: 'system', theme: 'light', startupConnection: null },
    files: {
      defaultView: 'details',
      previewLimits: { ...DEFAULT_PREVIEW_LIMITS },
      fileTypeExtensions: defaultFileTypeExtensions(),
      directoryUsageEntryLimit: DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT,
    },
    transfers: { fileConcurrency: 4 },
    monitoring: { sampleIntervalSeconds: 3, thresholds: structuredClone(DEFAULT_PERFORMANCE_THRESHOLDS) },
  }
}
export const DEFAULT_APP_SETTINGS = defaultAppSettings()

/** Validates a complete persisted snapshot. @param value Untrusted configuration. @returns Normalized settings. */
export function validateAppSettings(value: unknown): AppSettings {
  const result = appSettingsSchema.safeParse(value)
  if (!result.success) throw new LocalizedError(msg('errors.invalidApplicationSettingsStructure'))
  return result.data
}

/** Replaces one validated domain. @param current Current settings. @param input Untrusted request. @returns Complete updated settings. */
export function applyAppSettingsUpdate(current: AppSettings, input: unknown): AppSettings {
  const result = appSettingsUpdateSchema.safeParse(input)
  if (!result.success) throw new LocalizedError(msg('errors.invalidApplicationSettingsUpdate'))
  const update: AppSettingsUpdate = result.data
  return validateAppSettings({ ...current, [update.domain]: update.value })
}
