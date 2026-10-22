import { ScriptExecutionManager } from './script-executions'
import { getMainWindow, sessions } from './runtime'

const manager = new ScriptExecutionManager(
  (sessionId) => sessions.get(sessionId),
  (event) => {
    const window = getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send('files:script-execution-event', event)
  },
)

export function startScriptExecution(request: unknown): void {
  manager.start(request)
}

export function cancelScriptExecution(requestId: string): boolean {
  return manager.cancel(requestId)
}

export function cancelScriptExecutionsForSession(sessionId: string): void {
  manager.cancelForSession(sessionId)
}

export function failScriptExecutionsForSession(sessionId: string, message: string): void {
  manager.failForSession(sessionId, message)
}
