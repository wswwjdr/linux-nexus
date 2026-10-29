import { ipcMain } from 'electron'
import type { OperationExecutionRequest, RemoteOperationIntent } from '@shared/types'
import { cancelRemoteOperation, composeRemoteOperation, executeRemoteOperation } from '../remote-operations'

export function registerRemoteOperationsIpc(): void {
  ipcMain.handle('files:operation-compose', (_event, request: RemoteOperationIntent) => composeRemoteOperation(request))
  ipcMain.handle('files:operation-execute', (_event, request: OperationExecutionRequest) => executeRemoteOperation(request))
  ipcMain.handle('files:operation-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId) throw new Error('远端操作编号无效')
    return cancelRemoteOperation(requestId)
  })
}
