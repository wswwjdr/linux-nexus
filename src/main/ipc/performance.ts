import { LocalizedError, msg } from '../../shared/i18n/messages'
import { getPerformanceMonitorState, refreshPerformanceMonitor, setPerformanceMonitorEnabled } from '../performance-monitor'
import { profileFromState, readState } from '../state-store'
import { ipcMain } from './trusted-ipc'

/**
 * Validates a monitor target against the saved server configurations.
 * @param value Server configuration ID received over IPC.
 * @returns The validated configuration ID.
 */
function requireProfileId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new LocalizedError(msg('performance.invalidProfileId'))
  return profileFromState(readState(), value).id
}

/** Registers trusted IPC handlers for server-level monitoring. */
export function registerPerformanceIpc(): void {
  ipcMain.handle('performance:snapshot', (_event, profileId: unknown) => getPerformanceMonitorState(requireProfileId(profileId)))
  ipcMain.handle('performance:set-enabled', (_event, profileId: unknown, enabled: unknown) => {
    if (typeof enabled !== 'boolean') throw new LocalizedError(msg('performance.invalidSwitch'))
    return setPerformanceMonitorEnabled(requireProfileId(profileId), enabled)
  })
  ipcMain.handle('performance:refresh', (_event, profileId: unknown) => refreshPerformanceMonitor(requireProfileId(profileId)))
}
