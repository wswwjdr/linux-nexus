import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { RemoteMoveConflict, RemoteMoveDecision, RemoteMoveEvent, RemoteMoveItemResult, RemoteMoveRequest, RemoteMoveResult } from '@shared/types'
import type { SFTPWrapper } from 'ssh2'
import { fileType, normalizedRemotePath, remoteAttributesOrNull, sftpLstat, sftpReaddir, sftpRemoveTree, sftpRename, sftpRmdir, uniqueRemotePath } from './sftp-utils.ts'

interface MoveOutcome {
  movedCount: number
  skippedCount: number
  failures: string[]
  cancelled: boolean
}

interface MoveCallbacks {
  askConflict: (conflict: RemoteMoveConflict, signal: AbortSignal) => Promise<RemoteMoveDecision>
  onEvent: (event: RemoteMoveEvent) => void
}

interface ActiveMove {
  sessionId: string
  controller: AbortController
}

const activeMoves = new Map<string, ActiveMove>()

function emptyOutcome(): MoveOutcome {
  return { movedCount: 0, skippedCount: 0, failures: [], cancelled: false }
}

function mergeOutcome(target: MoveOutcome, source: MoveOutcome): void {
  target.movedCount += source.movedCount
  target.skippedCount += source.skippedCount
  target.failures.push(...source.failures)
  target.cancelled ||= source.cancelled
}

function remoteErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const code = (error as Error & { code?: string | number }).code
  if (code === 'EXDEV' || /cross[- ]device|different file systems?/i.test(error.message)) {
    return '跨远端文件系统，SFTP rename 不支持移动此项目；未执行复制或删除'
  }
  return error.message
}

function validateRequest(request: RemoteMoveRequest): RemoteMoveRequest {
  const targetDirectory = normalizedRemotePath(request.targetDirectory)
  const sourcePaths = request.sourcePaths.map(normalizedRemotePath)
  if (!request.requestId || !request.sessionId || sourcePaths.length === 0) throw new Error('移动请求无效')
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error('移动项目包含重复路径')
  for (const sourcePath of sourcePaths) {
    if (sourcePath === '/') throw new Error('不能移动服务器根目录')
    if (targetDirectory === sourcePath || targetDirectory.startsWith(sourcePath + '/')) {
      throw new Error('不能将文件夹移动到自身或其子文件夹中')
    }
  }
  return { ...request, targetDirectory, sourcePaths }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('移动已取消')
}

function conflictFor(
  request: RemoteMoveRequest,
  sourcePath: string,
  targetPath: string,
  sourceType: 'file' | 'directory',
  targetType: 'file' | 'directory',
): RemoteMoveConflict {
  return {
    requestId: request.requestId,
    conflictId: randomUUID(),
    sessionId: request.sessionId,
    sourcePath,
    targetPath,
    sourceName: posix.basename(sourcePath),
    targetName: posix.basename(targetPath),
    sourceType,
    targetType,
    conflictType: sourceType === 'file' && targetType === 'file' ? 'file' : 'type-mismatch',
  }
}

async function renameSource(sftp: SFTPWrapper, sourcePath: string, targetPath: string): Promise<void> {
  try {
    await sftpRename(sftp, sourcePath, targetPath)
  } catch (error) {
    throw new Error(remoteErrorMessage(error))
  }
}

export async function executeRemoteMove(
  sftp: SFTPWrapper,
  rawRequest: RemoteMoveRequest,
  callbacks: MoveCallbacks,
  signal: AbortSignal = new AbortController().signal,
): Promise<RemoteMoveResult> {
  const request = validateRequest(rawRequest)
  const targetAttributes = await sftpLstat(sftp, request.targetDirectory)
  if (fileType(targetAttributes.mode) !== 'directory') throw new Error('移动目标不是文件夹')

  for (const sourcePath of request.sourcePaths) {
    const attributes = await sftpLstat(sftp, sourcePath)
    const type = fileType(attributes.mode)
    if (type !== 'file' && type !== 'directory') throw new Error('不支持移动符号链接或其他类型：' + sourcePath)
    if (type === 'directory' && (request.targetDirectory === sourcePath || request.targetDirectory.startsWith(sourcePath + '/'))) {
      throw new Error('不能将文件夹移动到自身或其子文件夹中')
    }
  }

  const results: RemoteMoveItemResult[] = []
  let movedCount = 0
  let skippedCount = 0
  let failedCount = 0
  let cancelledCount = 0
  let filePolicy: 'replace' | 'skip' | 'rename' | null = null
  const totalCount = request.sourcePaths.length

  const moveNode = async (sourcePath: string, targetPath: string): Promise<MoveOutcome> => {
    const outcome = emptyOutcome()
    assertNotAborted(signal)
    const sourceAttributes = await sftpLstat(sftp, sourcePath)
    const sourceType = fileType(sourceAttributes.mode)
    if (sourceType !== 'file' && sourceType !== 'directory') throw new Error('不支持移动符号链接或其他类型：' + sourcePath)

    const targetAttributesForPath = await remoteAttributesOrNull(sftp, targetPath)
    if (!targetAttributesForPath) {
      assertNotAborted(signal)
      await renameSource(sftp, sourcePath, targetPath)
      outcome.movedCount += 1
      return outcome
    }

    const targetType = fileType(targetAttributesForPath.mode)
    if (targetType === 'other' || targetType === 'symlink') {
      throw new Error('目标路径是符号链接或其他不支持类型：' + targetPath)
    }

    if (sourceType === 'directory' && targetType === 'directory') {
      const children = await sftpReaddir(sftp, sourcePath)
      for (const child of children) {
        if (child.filename === '.' || child.filename === '..') continue
        if (child.filename.includes('/') || child.filename.includes('\0')) {
          outcome.failures.push(sourcePath + ': 服务器返回了无效的文件名')
          continue
        }
        if (signal.aborted) {
          outcome.cancelled = true
          break
        }
        const childSourcePath = posix.join(sourcePath, child.filename)
        const childTargetPath = posix.join(targetPath, child.filename)
        try {
          mergeOutcome(outcome, await moveNode(childSourcePath, childTargetPath))
        } catch (error) {
          if (signal.aborted) {
            outcome.cancelled = true
            break
          }
          outcome.failures.push(childSourcePath + ': ' + remoteErrorMessage(error))
        }
      }
      if (outcome.cancelled || signal.aborted) {
        outcome.cancelled = true
        return outcome
      }
      try {
        const remaining = await sftpReaddir(sftp, sourcePath)
        if (remaining.every((entry) => entry.filename === '.' || entry.filename === '..')) {
          await sftpRmdir(sftp, sourcePath)
          outcome.movedCount += 1
        }
      } catch (error) {
        outcome.failures.push(sourcePath + ': ' + remoteErrorMessage(error))
      }
      return outcome
    }

    const conflict = conflictFor(
      request,
      sourcePath,
      targetPath,
      sourceType as 'file' | 'directory',
      targetType as 'file' | 'directory',
    )
    let decision: RemoteMoveDecision
    if (conflict.conflictType === 'file' && filePolicy) {
      decision = filePolicy
    } else {
      decision = await callbacks.askConflict(conflict, signal)
    }
    if (signal.aborted || decision === 'cancel') {
      outcome.cancelled = true
      return outcome
    }

    if (conflict.conflictType === 'file') {
      if (decision === 'replace-all') {
        filePolicy = 'replace'
        decision = 'replace'
      } else if (decision === 'skip-all') {
        filePolicy = 'skip'
        decision = 'skip'
      } else if (decision === 'rename-all') {
        filePolicy = 'rename'
        decision = 'rename'
      }
    } else if (decision === 'replace-all' || decision === 'skip-all' || decision === 'rename-all') {
      throw new Error('异类型冲突不支持批量决策')
    } else if (decision === 'replace') {
      throw new Error('文件与文件夹类型不匹配时不允许覆盖目标')
    }

    if (decision === 'skip') {
      outcome.skippedCount += 1
      return outcome
    }
    if (decision === 'rename') {
      const renamedPath = await uniqueRemotePath(sftp, targetPath, sourceType as 'file' | 'directory')
      assertNotAborted(signal)
      await renameSource(sftp, sourcePath, renamedPath)
      outcome.movedCount += 1
      return outcome
    }
    if (decision !== 'replace') throw new Error('移动冲突决策无效')

    assertNotAborted(signal)
    await sftpRemoveTree(sftp, targetPath)
    await renameSource(sftp, sourcePath, targetPath)
    outcome.movedCount += 1
    return outcome
  }

  callbacks.onEvent({
    type: 'progress',
    progress: { requestId: request.requestId, sessionId: request.sessionId, completedCount: 0, totalCount, currentPath: null },
  })

  for (let index = 0; index < request.sourcePaths.length; index += 1) {
    const sourcePath = request.sourcePaths[index]
    callbacks.onEvent({
      type: 'progress',
      progress: { requestId: request.requestId, sessionId: request.sessionId, completedCount: index, totalCount, currentPath: sourcePath },
    })
    const outcome = emptyOutcome()
    if (signal.aborted) outcome.cancelled = true
    else if (posix.dirname(sourcePath) === request.targetDirectory) outcome.skippedCount = 1
    else {
      try {
        mergeOutcome(outcome, await moveNode(sourcePath, posix.join(request.targetDirectory, posix.basename(sourcePath))))
      } catch (error) {
        if (signal.aborted) outcome.cancelled = true
        else outcome.failures.push(remoteErrorMessage(error))
      }
    }

    const sourceName = posix.basename(sourcePath)
    movedCount += outcome.movedCount
    skippedCount += outcome.skippedCount
    if (outcome.cancelled) {
      cancelledCount += 1
      results.push({ sourcePath, sourceName, status: 'cancelled', ...(outcome.movedCount > 0 ? { message: '取消前已有部分内容移动' } : {}) })
    } else if (outcome.failures.length > 0) {
      failedCount += outcome.failures.length
      results.push({ sourcePath, sourceName, status: 'failed', message: outcome.failures.join('；') })
    } else if (outcome.movedCount > 0) {
      results.push({
        sourcePath,
        sourceName,
        status: 'moved',
        ...(outcome.skippedCount > 0 ? { message: `部分内容已跳过 ${outcome.skippedCount} 项` } : {}),
      })
    } else if (outcome.skippedCount > 0) {
      results.push({ sourcePath, sourceName, status: 'skipped' })
    } else {
      results.push({ sourcePath, sourceName, status: 'failed', message: '没有可移动的内容' })
      failedCount += 1
    }
    callbacks.onEvent({
      type: 'progress',
      progress: {
        requestId: request.requestId,
        sessionId: request.sessionId,
        completedCount: index + 1,
        totalCount,
        currentPath: null,
      },
    })
    if (outcome.cancelled || signal.aborted) break
  }

  return {
    status: signal.aborted || results.some((result) => result.status === 'cancelled') ? 'cancelled' : 'completed',
    results,
    movedCount,
    skippedCount,
    failedCount,
    cancelledCount,
  }
}

export function startRemoteMove(
  sftp: SFTPWrapper,
  request: RemoteMoveRequest,
  callbacks: MoveCallbacks,
): Promise<RemoteMoveResult> {
  if (activeMoves.has(request.requestId)) throw new Error('移动请求编号已在使用')
  if ([...activeMoves.values()].some((move) => move.sessionId === request.sessionId)) {
    throw new Error('此 SFTP 会话已有移动任务正在进行')
  }
  const controller = new AbortController()
  activeMoves.set(request.requestId, { sessionId: request.sessionId, controller })
  return executeRemoteMove(sftp, request, callbacks, controller.signal).finally(() => activeMoves.delete(request.requestId))
}

export function cancelRemoteMove(requestId: string): boolean {
  const move = activeMoves.get(requestId)
  if (!move) return false
  move.controller.abort()
  return true
}

export function cancelRemoteMovesForSession(sessionId: string): void {
  for (const [requestId, move] of activeMoves) {
    if (move.sessionId === sessionId) cancelRemoteMove(requestId)
  }
}
