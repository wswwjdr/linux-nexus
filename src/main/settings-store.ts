import { existsSync, readFileSync } from 'node:fs'
import type { AppSettings, PreviewLimits } from '@shared/types'
import { defaultAppSettings, validateAppSettings } from '@shared/app-settings'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { atomicWriteJson } from './json-store'
import { messageFromError } from './runtime'

let settingsFile = ''

/** Selects the configuration file. @param path Absolute preferences path. */
export function configureSettingsStore(path: string): void {
  settingsFile = path
}

/** Reads strictly validated settings or creates first-use defaults. @returns The persisted configuration. */
export function readAppSettings(): AppSettings {
  if (!settingsFile) throw new Error('Settings store is not configured')
  if (!existsSync(settingsFile)) return writeAppSettings(defaultAppSettings())
  try {
    return validateAppSettings(JSON.parse(readFileSync(settingsFile, 'utf8')))
  } catch (error) {
    throw new LocalizedError(
      msg('errors.invalidApplicationSettings', { settingsFile, value2: messageFromError(error) }),
    )
  }
}

/** Validates and atomically persists a complete snapshot. @param value Untrusted settings. @returns Saved settings. */
export function writeAppSettings(value: unknown): AppSettings {
  const settings = validateAppSettings(value)
  atomicWriteJson(settingsFile, settings)
  return settings
}

/** Returns current preview byte-limit preferences. @returns Preview limits in MiB. */
export function readPreviewLimits(): PreviewLimits {
  return readAppSettings().files.previewLimits
}
