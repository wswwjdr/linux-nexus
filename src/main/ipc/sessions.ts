import { ipcMain } from 'electron'
import type { SessionKind } from '@shared/types'
import { connectProfile, resizeTerminal, stopSession, writeTerminal } from '../connections'
import { sessions } from '../runtime'
import { activatePerformanceMonitor, deactivatePerformanceMonitor, getPerformanceMonitorState, refreshPerformanceMonitor } from '../performance-monitor'

export function registerSessionsIpc(): void {
  ipcMain.handle('connection:connect', (_event, sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof profileId !== 'string' || !profileId
      || (kind !== 'sftp' && kind !== 'terminal')
      || !Number.isInteger(cols) || cols < 1 || cols > 500
      || !Number.isInteger(rows) || rows < 1 || rows > 200
      || typeof startPath !== 'string') {
      throw new Error('会话连接参数无效')
    }
    if (sessions.has(sessionId)) throw new Error('会话编号已在使用')
    return connectProfile(sessionId, profileId, kind, cols, rows, startPath)
  })
  ipcMain.handle('connection:disconnect', (_event, sessionId: string) => stopSession(sessionId))
  ipcMain.handle('performance:state', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('性能监控会话编号无效')
    return getPerformanceMonitorState(sessionId)
  })
  ipcMain.handle('performance:activate', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('性能监控会话编号无效')
    return activatePerformanceMonitor(sessionId)
  })
  ipcMain.handle('performance:deactivate', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('性能监控会话编号无效')
    deactivatePerformanceMonitor(sessionId)
  })
  ipcMain.handle('performance:refresh', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('性能监控会话编号无效')
    refreshPerformanceMonitor(sessionId)
  })
  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    if (typeof data !== 'string' || data.length > 65536) throw new Error('终端输入无效')
    writeTerminal(sessionId, data)
  })
  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    if (!Number.isInteger(cols) || cols < 1 || cols > 500 || !Number.isInteger(rows) || rows < 1 || rows > 200) {
      throw new Error('终端尺寸无效')
    }
    resizeTerminal(sessionId, cols, rows)
  })
}
