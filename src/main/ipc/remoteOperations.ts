import { ipcMain } from 'electron'
import type { RemoteCopyDecision, RemoteCopyRequest, RemoteMoveDecision, RemoteMoveRequest } from '@shared/types'
import { cancelRemoteMove, startRemoteMove } from '../remote-moves'
import { executeRemoteCopy } from '../remote-copies'
import { sessions } from '../runtime'

const pendingMoveDecisions = new Map<string, {
  conflictId: string
  senderId: number
  resolve: (decision: RemoteMoveDecision) => void
}>()
const activeMoveOwners = new Map<string, number>()
const pendingCopyDecisions = new Map<string, {
  conflictId: string
  senderId: number
  resolve: (decision: RemoteCopyDecision) => void
}>()
const activeCopyOwners = new Map<string, number>()

function parseRemoteMoveRequest(value: unknown): RemoteMoveRequest {
  if (!value || typeof value !== 'object') throw new Error('移动请求无效')
  const request = value as Partial<RemoteMoveRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.targetDirectory !== 'string'
    || !Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0
    || request.sourcePaths.some((path) => typeof path !== 'string')) {
    throw new Error('移动请求参数无效')
  }
  return request as RemoteMoveRequest
}

function parseRemoteCopyRequest(value: unknown): RemoteCopyRequest {
  if (!value || typeof value !== 'object') throw new Error('复制请求无效')
  const request = value as Partial<RemoteCopyRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.targetDirectory !== 'string'
    || !Array.isArray(request.sourcePaths) || request.sourcePaths.length === 0
    || request.sourcePaths.some((path) => typeof path !== 'string')) {
    throw new Error('复制请求参数无效')
  }
  return request as RemoteCopyRequest
}

export function registerRemoteOperationsIpc(): void {
  ipcMain.handle('files:move-start', (event, value: unknown) => {
    const request = parseRemoteMoveRequest(value)
    const session = sessions.get(request.sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    const sender = event.sender
    if (activeMoveOwners.has(request.requestId)) throw new Error('移动请求编号已在使用')
    activeMoveOwners.set(request.requestId, sender.id)
    const onSenderDestroyed = () => cancelRemoteMove(request.requestId)
    let run: ReturnType<typeof startRemoteMove>
    try {
      run = startRemoteMove(session.sftp, request, {
        onEvent: (moveEvent) => {
          if (!sender.isDestroyed()) sender.send('files:move-event', moveEvent)
        },
        askConflict: (conflict, signal) => new Promise((resolve) => {
          if (signal.aborted || sender.isDestroyed()) {
            resolve('cancel')
            return
          }
          const previous = pendingMoveDecisions.get(request.requestId)
          if (previous) throw new Error('移动任务同时出现多个冲突')
          const finish = (decision: RemoteMoveDecision) => {
            signal.removeEventListener('abort', onAbort)
            if (pendingMoveDecisions.get(request.requestId)?.conflictId === conflict.conflictId) {
              pendingMoveDecisions.delete(request.requestId)
            }
            resolve(decision)
          }
          const onAbort = () => finish('cancel')
          pendingMoveDecisions.set(request.requestId, {
            conflictId: conflict.conflictId,
            senderId: sender.id,
            resolve: finish,
          })
          signal.addEventListener('abort', onAbort, { once: true })
          sender.send('files:move-event', { type: 'conflict', conflict })
        }),
      })
    } catch (error) {
      activeMoveOwners.delete(request.requestId)
      throw error
    }
    sender.once('destroyed', onSenderDestroyed)
    return run.finally(() => {
      sender.removeListener('destroyed', onSenderDestroyed)
      activeMoveOwners.delete(request.requestId)
      const pending = pendingMoveDecisions.get(request.requestId)
      if (pending) pending.resolve('cancel')
    })
  })
  ipcMain.handle('files:move-decision', (event, requestId: unknown, conflictId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string' || typeof conflictId !== 'string'
      || !['replace', 'skip', 'rename', 'replace-all', 'skip-all', 'rename-all', 'cancel'].includes(String(decision))) return false
    const pending = pendingMoveDecisions.get(requestId)
    if (!pending || pending.senderId !== event.sender.id || pending.conflictId !== conflictId) return false
    pending.resolve(decision as RemoteMoveDecision)
    return true
  })
  ipcMain.handle('files:move-cancel', (event, requestId: unknown) => {
    if (typeof requestId !== 'string' || activeMoveOwners.get(requestId) !== event.sender.id) return false
    return cancelRemoteMove(requestId)
  })
  ipcMain.handle('files:copy-start', (event, value: unknown) => {
    const request = parseRemoteCopyRequest(value)
    const session = sessions.get(request.sessionId)
    if (!session?.sftp) throw new Error('SFTP 会话未连接')
    const sender = event.sender
    if (activeCopyOwners.has(request.requestId)) throw new Error('复制请求编号已在使用')
    activeCopyOwners.set(request.requestId, sender.id)
    const onSenderDestroyed = () => pendingCopyDecisions.get(request.requestId)?.resolve('cancel')
    let run: ReturnType<typeof executeRemoteCopy>
    try {
      run = executeRemoteCopy(session.sftp, request, {
        onEvent: (copyEvent) => {
          if (!sender.isDestroyed()) sender.send('files:copy-event', copyEvent)
        },
        askConflict: (conflict) => new Promise((resolve) => {
          if (sender.isDestroyed()) {
            resolve('cancel')
            return
          }
          if (pendingCopyDecisions.has(request.requestId)) throw new Error('复制任务同时出现多个冲突')
          const finish = (decision: RemoteCopyDecision) => {
            if (pendingCopyDecisions.get(request.requestId)?.conflictId === conflict.conflictId) {
              pendingCopyDecisions.delete(request.requestId)
            }
            resolve(decision)
          }
          pendingCopyDecisions.set(request.requestId, {
            conflictId: conflict.conflictId,
            senderId: sender.id,
            resolve: finish,
          })
          sender.send('files:copy-event', { type: 'conflict', conflict })
        }),
      })
    } catch (error) {
      activeCopyOwners.delete(request.requestId)
      throw error
    }
    sender.once('destroyed', onSenderDestroyed)
    return run.finally(() => {
      sender.removeListener('destroyed', onSenderDestroyed)
      activeCopyOwners.delete(request.requestId)
      const pending = pendingCopyDecisions.get(request.requestId)
      if (pending) pending.resolve('cancel')
    })
  })
  ipcMain.handle('files:copy-decision', (event, requestId: unknown, conflictId: unknown, decision: unknown) => {
    if (typeof requestId !== 'string' || typeof conflictId !== 'string'
      || !['replace', 'skip', 'rename', 'replace-all', 'skip-all', 'rename-all', 'cancel'].includes(String(decision))) return false
    const pending = pendingCopyDecisions.get(requestId)
    if (!pending || pending.senderId !== event.sender.id || pending.conflictId !== conflictId) return false
    pending.resolve(decision as RemoteCopyDecision)
    return true
  })
}
