import { randomUUID } from 'node:crypto'
import { getMainWindow } from './runtime'
import { BrowserWindow } from 'electron'
import type { AppSettings } from '@shared/types'
import { applyAppSettingsUpdate } from '@shared/app-settings'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { readAppSettings, writeAppSettings } from './settings-store'
import { readState } from './state-store'
import { applyLanguage } from './language'
import { applyTheme } from './theme'
import { configurePerformanceMonitorInterval } from './performance-monitor'

/** Commits one domain and publishes the successful snapshot. @param input Untrusted domain update. @returns Persisted settings. */
export function updateAppSettings(input: unknown): AppSettings {
  const current = readAppSettings()
  const next = applyAppSettingsUpdate(current, input)
  const connection = next.general.startupConnection
  if (connection && !readState().profiles.some((profile) => profile.id === connection.profileId)) {
    throw new LocalizedError(msg('errors.theServerSelectedForStartupConnectionDoesNotExist'))
  }
  const saved = writeAppSettings(next)
  applyLanguage(saved.general.language)
  applyTheme(saved.general.theme)
  if (current.monitoring.sampleIntervalSeconds !== saved.monitoring.sampleIntervalSeconds) {
    configurePerformanceMonitorInterval(saved.monitoring.sampleIntervalSeconds)
  }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('settings:changed', saved)
  return saved
}

let exitRequest: { id: string; resolve: (allow: boolean) => void } | undefined

/** Requests completion of renderer-owned settings edits before shutdown. @returns Whether shutdown can proceed. */
export function prepareSettingsExit(): Promise<boolean> {
  const window = getMainWindow()
  if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.isLoadingMainFrame())
    return Promise.resolve(true)
  if (exitRequest) throw new Error('Settings exit preparation is already running')
  return new Promise((resolve) => {
    const id = randomUUID()
    /** Completes this request and releases its lifecycle listener. @param allow Whether exit is approved. */
    const finish = (allow: boolean): void => {
      window.removeListener('closed', destroyed)
      window.webContents.removeListener('render-process-gone', destroyed)
      exitRequest = undefined
      resolve(allow)
    }
    /** Releases the pending request when the renderer window is gone. */
    const destroyed = (): void => finish(true)
    exitRequest = { id, resolve: finish }
    window.once('closed', destroyed)
    window.webContents.once('render-process-gone', destroyed)
    window.webContents.send('settings:prepare-close', id)
  })
}

/** Accepts the renderer response to the current shutdown request. @param id Request identity. @param allow Whether pending edits are resolved. */
export function completeSettingsExit(id: unknown, allow: unknown): void {
  if (typeof id !== 'string' || typeof allow !== 'boolean' || id !== exitRequest?.id) {
    throw new LocalizedError(msg('errors.invalidApplicationSettingsUpdate'))
  }
  exitRequest.resolve(allow)
}
