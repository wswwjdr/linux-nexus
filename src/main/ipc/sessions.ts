import { msg, LocalizedError } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import type { SessionKind } from '@shared/types'
import { connectProfile, resizeTerminal, stopSession, writeTerminal } from '../connections'
import { sessions } from '../runtime'
import { focusPerformanceMonitor, refreshPerformanceMonitor, setPerformanceMonitorEnabled } from '../performance-monitor'

/** Registers trusted handlers for SSH sessions, terminal I/O, and monitor controls. */
export function registerSessionsIpc(): void {
  ipcMain.handle('connection:connect', (_event, sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string, rootSourceSessionId?: string) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof profileId !== 'string' || !profileId
      || (kind !== 'files' && kind !== 'terminal')
      || !Number.isInteger(cols) || cols < 1 || cols > 500
      || !Number.isInteger(rows) || rows < 1 || rows > 200
      || typeof startPath !== 'string' || startPath.includes('\0')
      || (rootSourceSessionId !== undefined && (kind !== 'terminal' || typeof rootSourceSessionId !== 'string' || !rootSourceSessionId))) {
      throw new LocalizedError(msg('errors.invalidSessionConnectionParameters'))
    }
    if (sessions.has(sessionId)) throw new LocalizedError(msg('errors.sessionIdIsAlreadyInUse'))
    return connectProfile(sessionId, profileId, kind, cols, rows, startPath, rootSourceSessionId)
  })
  ipcMain.handle('connection:disconnect', (_event, sessionId: string) => stopSession(sessionId))
  ipcMain.handle('performance:focus', (_event, sessionId: unknown) => {
    if (sessionId !== null && (typeof sessionId !== 'string' || !sessionId)) {
      throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    }
    return focusPerformanceMonitor(sessionId)
  })
  ipcMain.handle('performance:set-enabled', (_event, sessionId: unknown, enabled: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    if (typeof enabled !== 'boolean') throw new LocalizedError(msg('performance.invalidSwitch'))
    return setPerformanceMonitorEnabled(sessionId, enabled)
  })
  ipcMain.handle('performance:refresh', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    refreshPerformanceMonitor(sessionId)
  })
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    if (typeof data !== 'string' || data.length > 65536) throw new LocalizedError(msg('errors.invalidTerminalInput'))
    writeTerminal(sessionId, data)
  })
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) {
      throw new LocalizedError(msg('errors.invalidTerminalDimensions'))
    }
    resizeTerminal(sessionId, cols, rows)
  })
}
