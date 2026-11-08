import { msg, LocalizedError } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import type { OperationExecutionRequest } from '@shared/types'
import { cancelRemoteOperation, executeRemoteOperation } from '../remote-operations'

export function registerRemoteOperationsIpc(): void {
  ipcMain.handle('files:operation-execute', (_event, request: OperationExecutionRequest) => executeRemoteOperation(request))
  ipcMain.handle('files:operation-cancel', (_event, requestId: unknown) => {
    if (typeof requestId !== 'string' || !requestId) throw new LocalizedError(msg('errors.invalidRemoteOperationId'))
    return cancelRemoteOperation(requestId)
  })
}
