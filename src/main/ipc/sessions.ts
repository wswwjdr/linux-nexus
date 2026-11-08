import { msg, LocalizedError } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import type { SessionKind } from '@shared/types'
import { connectProfile, resizeTerminal, stopSession, writeTerminal } from '../connections'
import { sessions } from '../runtime'
import { activatePerformanceMonitor, deactivatePerformanceMonitor, getPerformanceMonitorState, refreshPerformanceMonitor } from '../performance-monitor'

export function registerSessionsIpc(): void {
  ipcMain.handle('connection:connect', (_event, sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof profileId !== 'string' || !profileId
      || (kind !== 'files' && kind !== 'terminal')
      || !Number.isInteger(cols) || cols < 1 || cols > 500
      || !Number.isInteger(rows) || rows < 1 || rows > 200
      || typeof startPath !== 'string') {
      throw new LocalizedError(msg('errors.invalidSessionConnectionParameters'))
    }
    if (sessions.has(sessionId)) throw new LocalizedError(msg('errors.sessionIdIsAlreadyInUse'))
    return connectProfile(sessionId, profileId, kind, cols, rows, startPath)
  })
  ipcMain.handle('connection:disconnect', (_event, sessionId: string) => stopSession(sessionId))
  ipcMain.handle('performance:state', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    return getPerformanceMonitorState(sessionId)
  })
  ipcMain.handle('performance:activate', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    return activatePerformanceMonitor(sessionId)
  })
  ipcMain.handle('performance:deactivate', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.invalidPerformanceMonitoringSessionId'))
    deactivatePerformanceMonitor(sessionId)
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
