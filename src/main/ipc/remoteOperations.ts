import { ipcMain } from 'electron'
import type { ArchiveDependency, OperationExecutionRequest, OperationPreflightRequest } from '@shared/types'
import { cancelRemoteOperation, executeRemoteOperation, installArchiveDependencies, preflightRemoteOperation } from '../remote-operations'

export function registerRemoteOperationsIpc(): void {
  ipcMain.handle('files:operation-preflight', (_event, request: OperationPreflightRequest) => preflightRemoteOperation(request))
  ipcMain.handle('files:operation-execute', (_event, request: OperationExecutionRequest) => executeRemoteOperation(request))
  ipcMain.handle('files:operation-cancel', (_event, preflightId: unknown) => {
    if (typeof preflightId !== 'string' || !preflightId) throw new Error('远端操作编号无效')
    return cancelRemoteOperation(preflightId)
  })
  ipcMain.handle('files:archive-dependencies-install', (_event, sessionId: unknown, dependencies: unknown, password: unknown) => {
    if (typeof sessionId !== 'string' || !sessionId || typeof password !== 'string' || !Array.isArray(dependencies)) {
      throw new Error('归档依赖安装参数无效')
    }
    return installArchiveDependencies(sessionId, dependencies as ArchiveDependency[], password)
  })
}
