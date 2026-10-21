import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type {
  RemoteCopyConflict,
  RemoteCopyDecision,
  RemoteCopyItemResult,
  RemoteCopyRequest,
  RemoteCopyResult,
} from '@shared/types'
import type { SFTPWrapper } from 'ssh2'
import { fileType, normalizedRemotePath, remoteAttributesOrNull, sftpLstat, sftpMkdir, sftpReaddir, sftpRemoveTree } from './sftp-utils.ts'
import { MAX_TRANSFER_REQUESTS, TRANSFER_CHUNK_SIZE } from './transfers/block-transfer.ts'

interface CopyCallbacks {
  askConflict: (conflict: RemoteCopyConflict) => Promise<RemoteCopyDecision>
  onEvent: (event: { type: 'conflict'; conflict: RemoteCopyConflict }) => void
}

interface CopyOutcome {
  copiedCount: number
  skippedCount: number
  failures: string[]
  cancelled: boolean
}

const activeCopies = new Set<string>()

function emptyOutcome(): CopyOutcome {
  return { copiedCount: 0, skippedCount: 0, failures: [], cancelled: false }
}

function mergeOutcome(target: CopyOutcome, source: CopyOutcome): void {
  target.copiedCount += source.copiedCount
  target.skippedCount += source.skippedCount
  target.failures.push(...source.failures)
  target.cancelled ||= source.cancelled
}

function validateRequest(request: RemoteCopyRequest): RemoteCopyRequest {
  const targetDirectory = normalizedRemotePath(request.targetDirectory)
  const sourcePaths = request.sourcePaths.map(normalizedRemotePath)
  if (!request.requestId || !request.sessionId || sourcePaths.length === 0) throw new Error('复制请求无效')
  if (new Set(sourcePaths).size !== sourcePaths.length) throw new Error('复制项目包含重复路径')
  if (sourcePaths.some((sourcePath) => sourcePath === '/')) throw new Error('不能复制服务器根目录')
  return { ...request, sourcePaths, targetDirectory }
}

function remoteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function openRemoteFile(sftp: SFTPWrapper, remotePath: string, mode: 'r' | 'w'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(remotePath, mode, (error, handle) => error ? reject(error) : resolve(handle))
  })
}

function closeRemoteFile(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (error) => error ? reject(error) : resolve())
  })
}

async function copyRemoteFile(sftp: SFTPWrapper, sourcePath: string, targetPath: string, size: number): Promise<void> {
  let sourceHandle: Buffer | undefined
  let targetHandle: Buffer | undefined
  let copyError: unknown
  try {
    sourceHandle = await openRemoteFile(sftp, sourcePath, 'r')
    targetHandle = await openRemoteFile(sftp, targetPath, 'w')
    let nextPosition = 0
    let firstError: unknown
    let hasFirstError = false
    const blockCount = Math.ceil(size / TRANSFER_CHUNK_SIZE)
    const workerCount = Math.min(blockCount, MAX_TRANSFER_REQUESTS)
    const workers = Array.from({ length: workerCount }, async () => {
      while (!hasFirstError) {
        const position = nextPosition
        nextPosition += TRANSFER_CHUNK_SIZE
        if (position >= size) return
        const length = Math.min(TRANSFER_CHUNK_SIZE, size - position)
        const buffer = Buffer.allocUnsafe(length)
        let offset = 0
        try {
          while (offset < length) {
            const bytesRead = await new Promise<number>((resolve, reject) => {
              sftp.read(sourceHandle!, buffer, offset, length - offset, position + offset, (error, count) => {
                if (error) reject(error)
                else resolve(count)
              })
            })
            if (bytesRead === 0) throw new Error('源文件在复制期间发生变化')
            offset += bytesRead
          }
          await new Promise<void>((resolve, reject) => {
            sftp.write(targetHandle!, buffer, 0, buffer.length, position, (error) => error ? reject(error) : resolve())
          })
        } catch (error) {
          if (!hasFirstError) {
            firstError = error
            hasFirstError = true
          }
          return
        }
      }
    })
    await Promise.all(workers)
    if (hasFirstError) throw firstError
  } catch (error) {
    copyError = error
  }

  const closeErrors: unknown[] = []
  if (targetHandle) {
    try {
      await closeRemoteFile(sftp, targetHandle)
    } catch (error) {
      closeErrors.push(error)
    }
  }
  if (sourceHandle) {
    try {
      await closeRemoteFile(sftp, sourceHandle)
    } catch (error) {
      closeErrors.push(error)
    }
  }
  if (copyError) throw copyError
  if (closeErrors.length > 0) throw closeErrors[0]
}

function duplicateName(name: string, type: 'file' | 'directory', index: number): string {
  if (type === 'directory') return `${name} - 副本${index > 1 ? ` (${index})` : ''}`
  const extensionIndex = name.lastIndexOf('.')
  const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : ''
  return `${stem} - 副本${index > 1 ? ` (${index})` : ''}${extension}`
}

async function uniqueCopyPath(
  sftp: SFTPWrapper,
  sourcePath: string,
  targetDirectory: string,
  type: 'file' | 'directory',
): Promise<string> {
  const sourceName = posix.basename(sourcePath)
  let index = 1
  while (true) {
    const targetPath = posix.join(targetDirectory, duplicateName(sourceName, type, index))
    if (!await remoteAttributesOrNull(sftp, targetPath)) return targetPath
    index += 1
  }
}

function makeConflict(
  request: RemoteCopyRequest,
  sourcePath: string,
  targetPath: string,
  sourceType: 'file' | 'directory',
  targetType: 'file' | 'directory',
): RemoteCopyConflict {
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

export async function executeRemoteCopy(
  sftp: SFTPWrapper,
  rawRequest: RemoteCopyRequest,
  callbacks: CopyCallbacks,
): Promise<RemoteCopyResult> {
  const request = validateRequest(rawRequest)
  if (activeCopies.has(request.sessionId)) throw new Error('此 SFTP 会话已有复制任务正在进行')
  activeCopies.add(request.sessionId)
  try {
    const targetAttributes = await sftpLstat(sftp, request.targetDirectory)
    if (fileType(targetAttributes.mode) !== 'directory') throw new Error('复制目标不是文件夹')

    const results: RemoteCopyItemResult[] = []
    let copiedCount = 0
    let skippedCount = 0
    let failedCount = 0
    let cancelledCount = 0
    let filePolicy: 'replace' | 'skip' | null = null

    async function copyNode(sourcePath: string, targetPath: string): Promise<CopyOutcome> {
      const outcome = emptyOutcome()
      const sourceAttributes = await sftpLstat(sftp, sourcePath)
      const sourceKind = fileType(sourceAttributes.mode)
      if (sourceKind !== 'file' && sourceKind !== 'directory') throw new Error('不支持复制符号链接或其他类型：' + sourcePath)

      const targetAttributesForPath = await remoteAttributesOrNull(sftp, targetPath)
      if (!targetAttributesForPath) {
        if (sourceKind === 'file') {
          await copyRemoteFile(sftp, sourcePath, targetPath, sourceAttributes.size ?? 0)
          outcome.copiedCount += 1
          return outcome
        }
        await sftpMkdir(sftp, targetPath)
        outcome.copiedCount += 1
        await copyDirectoryChildren(sourcePath, targetPath, outcome)
        return outcome
      }

      const targetKind = fileType(targetAttributesForPath.mode)
      if (targetKind === 'other' || targetKind === 'symlink') throw new Error('目标路径是符号链接或其他不支持类型：' + targetPath)
      if (sourceKind === 'directory' && targetKind === 'directory') {
        outcome.copiedCount += 1
        await copyDirectoryChildren(sourcePath, targetPath, outcome)
        return outcome
      }

      const conflict = makeConflict(request, sourcePath, targetPath, sourceKind, targetKind)
      let decision: RemoteCopyDecision
      if (conflict.conflictType === 'file' && filePolicy) {
        decision = filePolicy
      } else {
        callbacks.onEvent({ type: 'conflict', conflict })
        decision = await callbacks.askConflict(conflict)
      }
      if (decision === 'cancel') {
        outcome.cancelled = true
        return outcome
      }
      if (conflict.conflictType === 'file') {
        if (decision === 'replace-all') {
          filePolicy = 'replace'
        } else if (decision === 'skip-all') {
          filePolicy = 'skip'
        }
      } else if (decision === 'replace-all' || decision === 'skip-all') {
        throw new Error('复制冲突决策无效')
      }
      if (decision === 'skip' || decision === 'skip-all') {
        outcome.skippedCount += 1
        return outcome
      }
      if (decision !== 'replace' && decision !== 'replace-all') throw new Error('复制冲突决策无效')

      await sftpRemoveTree(sftp, targetPath)
      if (sourceKind === 'file') {
        await copyRemoteFile(sftp, sourcePath, targetPath, sourceAttributes.size ?? 0)
        outcome.copiedCount += 1
        return outcome
      }
      await sftpMkdir(sftp, targetPath)
      outcome.copiedCount += 1
      await copyDirectoryChildren(sourcePath, targetPath, outcome)
      return outcome
    }

    async function copyDirectoryChildren(sourceDirectory: string, targetDirectory: string, outcome: CopyOutcome): Promise<void> {
      for (const entry of await sftpReaddir(sftp, sourceDirectory)) {
        if (entry.filename === '.' || entry.filename === '..') continue
        if (entry.filename.includes('/') || entry.filename.includes('\0')) {
          outcome.failures.push(sourceDirectory + ': 服务器返回了无效的文件名')
          continue
        }
        const childSourcePath = posix.join(sourceDirectory, entry.filename)
        const childTargetPath = posix.join(targetDirectory, entry.filename)
        try {
          mergeOutcome(outcome, await copyNode(childSourcePath, childTargetPath))
        } catch (error) {
          outcome.failures.push(childSourcePath + ': ' + remoteErrorMessage(error))
        }
        if (outcome.cancelled) return
      }
    }

    for (const sourcePath of request.sourcePaths) {
      const sourceName = posix.basename(sourcePath)
      const outcome = emptyOutcome()
      try {
        const sourceAttributes = await sftpLstat(sftp, sourcePath)
        const sourceKind = fileType(sourceAttributes.mode)
        if (sourceKind !== 'file' && sourceKind !== 'directory') throw new Error('不支持复制符号链接或其他类型：' + sourcePath)
        if (sourceKind === 'directory' && (request.targetDirectory === sourcePath || request.targetDirectory.startsWith(sourcePath + '/'))) {
          throw new Error('不能将文件夹复制到自身或其子文件夹中')
        }
        const targetPath = posix.dirname(sourcePath) === request.targetDirectory
          ? await uniqueCopyPath(sftp, sourcePath, request.targetDirectory, sourceKind)
          : posix.join(request.targetDirectory, sourceName)
        mergeOutcome(outcome, await copyNode(sourcePath, targetPath))
      } catch (error) {
        outcome.failures.push(remoteErrorMessage(error))
      }

      copiedCount += outcome.copiedCount
      skippedCount += outcome.skippedCount
      if (outcome.cancelled) {
        cancelledCount += 1
        results.push({ sourcePath, sourceName, status: 'cancelled', ...(outcome.copiedCount > 0 ? { message: '取消前已有部分内容复制' } : {}) })
      } else if (outcome.failures.length > 0) {
        failedCount += outcome.failures.length
        results.push({ sourcePath, sourceName, status: 'failed', message: outcome.failures.join('；') })
      } else if (outcome.copiedCount > 0) {
        results.push({
          sourcePath,
          sourceName,
          status: 'copied',
          ...(outcome.skippedCount > 0 ? { message: `部分内容已跳过 ${outcome.skippedCount} 项` } : {}),
        })
      } else if (outcome.skippedCount > 0) {
        results.push({ sourcePath, sourceName, status: 'skipped' })
      } else {
        failedCount += 1
        results.push({ sourcePath, sourceName, status: 'failed', message: '没有可复制的内容' })
      }
      if (outcome.cancelled) break
    }

    return {
      status: cancelledCount > 0 ? 'cancelled' : 'completed',
      results,
      copiedCount,
      skippedCount,
      failedCount,
      cancelledCount,
    }
  } finally {
    activeCopies.delete(request.sessionId)
  }
}
