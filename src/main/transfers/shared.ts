import { lstat as localLstat, readdir as localReaddir } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import type { TransferFailure, TransferResult } from '@shared/types'
import { activeTransfers, messageFromError, sessions, type TransferItem } from '../runtime'
import { fileType, sftpLstat, sftpReaddir } from '../sftp-utils'
import type { SFTPWrapper } from 'ssh2'
import type { TransferProgressReporter } from './progress'
import { MAX_TRANSFER_REQUESTS } from './block-transfer'

const transferQueues = new Map<string, Promise<void>>()

export interface TransferFileTask {
  path: string
  size: number
  transfer: (requestConcurrency: number, onProgress: (bytes: number) => void) => Promise<void>
}

export interface CollectedTransferTree {
  items: TransferItem[]
  failures: TransferFailure[]
}

export function findPathCollisions(items: TransferItem[], pathKey: (item: TransferItem) => string): TransferItem[][] {
  const groups = new Map<string, TransferItem[]>()
  for (const item of items) {
    const key = pathKey(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return [...groups.values()].filter((group) => group.length > 1)
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR'
  if (typeof error !== 'object' || error === null) return false
  return ('name' in error && error.name === 'AbortError') || ('code' in error && error.code === 'ABORT_ERR')
}

export async function runTransferTasks(
  tasks: TransferFileTask[],
  concurrency: number,
  signal: AbortSignal,
  progress: TransferProgressReporter,
): Promise<TransferFailure[]> {
  const failures: TransferFailure[] = []
  const workerCount = Math.min(concurrency, tasks.length)
  const requestConcurrency = workerCount ? Math.max(1, Math.floor(MAX_TRANSFER_REQUESTS / workerCount)) : 1
  let nextTask = 0

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!signal.aborted) {
      const task = tasks[nextTask++]
      if (!task) return
      progress.fileStarted(task.path, task.size)
      try {
        await task.transfer(requestConcurrency, (bytes) => progress.fileAdvanced(task.path, bytes))
        progress.fileFinished(task.path, true)
      } catch (error) {
        if (signal.aborted) {
          progress.fileCancelled(task.path)
          return
        }
        progress.fileFinished(task.path, false)
        failures.push({ path: task.path, message: messageFromError(error) })
      }
    }
  }))

  signal.throwIfAborted()
  return failures
}

export async function collectRemoteTree(sftp: SFTPWrapper, remoteRoot: string, signal: AbortSignal): Promise<CollectedTransferTree> {
  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  const visit = async (remotePath: string, relativePath: string, attrs: Awaited<ReturnType<typeof sftpLstat>>) => {
    signal.throwIfAborted()
    const type = fileType(attrs.mode)
    if (type === 'symlink') {
      failures.push({ path: remotePath, message: '目录包含符号链接，无法传输' })
      return
    }
    if (type === 'other') {
      failures.push({ path: remotePath, message: '目录包含暂不支持的文件类型' })
      return
    }
    items.push({ relativePath, type, size: attrs.size ?? 0, remotePath })
    if (type !== 'directory') return
    let entries: Awaited<ReturnType<typeof sftpReaddir>>
    try {
      entries = await sftpReaddir(sftp, remotePath)
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({ path: remotePath, message: messageFromError(error) })
      return
    }
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.filename === '.' || entry.filename === '..') continue
      const childPath = posix.join(remotePath, entry.filename)
      const childRelativePath = relativePath ? posix.join(relativePath, entry.filename) : entry.filename
      await visit(childPath, childRelativePath, entry.attrs)
    }
  }
  try {
    await visit(remoteRoot, '', await sftpLstat(sftp, remoteRoot))
  } catch (error) {
    if (signal.aborted) throw error
    failures.push({ path: remoteRoot, message: messageFromError(error) })
  }
  return { items, failures }
}

export async function collectLocalTree(localRoot: string, signal: AbortSignal): Promise<CollectedTransferTree> {
  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  const visit = async (localPath: string, relativePath: string) => {
    signal.throwIfAborted()
    let attrs: Awaited<ReturnType<typeof localLstat>>
    try {
      attrs = await localLstat(localPath)
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({ path: localPath, message: messageFromError(error) })
      return
    }
    if (attrs.isSymbolicLink()) {
      failures.push({ path: localPath, message: '目录包含符号链接，无法传输' })
      return
    }
    if (attrs.isDirectory()) {
      items.push({ relativePath, type: 'directory', size: 0, localPath })
      let entries: Dirent[]
      try {
        entries = await localReaddir(localPath, { withFileTypes: true })
      } catch (error) {
        if (signal.aborted) throw error
        failures.push({ path: localPath, message: messageFromError(error) })
        return
      }
      for (const entry of entries) {
        signal.throwIfAborted()
        const childPath = join(localPath, entry.name)
        const childRelativePath = relativePath ? posix.join(relativePath, entry.name) : entry.name
        await visit(childPath, childRelativePath)
      }
      return
    }
    if (!attrs.isFile()) {
      failures.push({ path: localPath, message: '目录包含暂不支持的文件类型' })
      return
    }
    items.push({ relativePath, type: 'file', size: attrs.size, localPath })
  }
  await visit(localRoot, '')
  return { items, failures }
}

export function assertWindowsPath(relativePath: string): void {
  for (const name of relativePath.split(/[\/\\]/)) {
    if (!name) continue
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
      throw new Error('Windows 不支持此文件名，无法下载：' + name)
    }
  }
}

export async function withTransferLock(
  profileId: string,
  sessionId: string,
  requestId: string,
  operation: (signal: AbortSignal) => Promise<TransferResult>,
  onQueued?: () => void,
): Promise<TransferResult> {
  if (activeTransfers.has(requestId)) throw new Error('传输请求标识重复')
  const transfer = { profileId, sessionId, controller: new AbortController(), settled: Promise.resolve() }
  const previous = transferQueues.get(profileId) ?? Promise.resolve()
  const wasQueued = transferQueues.has(profileId)
  let releaseTurn!: () => void
  const turn = new Promise<void>((resolve) => { releaseTurn = resolve })
  const queueTail = previous.then(() => turn)
  transferQueues.set(profileId, queueTail)
  activeTransfers.set(requestId, transfer)

  if (wasQueued) onQueued?.()

  const operationPromise = (async () => {
    try {
      await previous
      transfer.controller.signal.throwIfAborted()
      return await operation(transfer.controller.signal)
    } finally {
      releaseTurn()
      if (transferQueues.get(profileId) === queueTail) transferQueues.delete(profileId)
    }
  })()
  transfer.settled = operationPromise.then(() => undefined, () => undefined)

  try {
    return await operationPromise
  } catch (error) {
    if (transfer.controller.signal.aborted && isAbortError(error)) return { status: 'cancelled' }
    throw error
  } finally {
    activeTransfers.delete(requestId)
  }
}

export function cancelTransfer(requestId: string): boolean {
  const transfer = activeTransfers.get(requestId)
  if (!transfer) return false
  transfer.controller.abort()
  return true
}

export function cancelTransfersForSession(sessionId: string) {
  const transfers = [...activeTransfers.values()].filter((transfer) => transfer.sessionId === sessionId)
  for (const transfer of transfers) transfer.controller.abort()
  return transfers
}

export function localDestination(destinationRoot: string, relativePath: string): string {
  const root = resolve(destinationRoot)
  const destination = relativePath ? resolve(root, ...relativePath.split(/[\\/]/)) : root
  const fromRoot = relative(root, destination)
  if (fromRoot === '..' || fromRoot.startsWith('..' + sep) || isAbsolute(fromRoot)) {
    throw new Error('下载路径无效：' + relativePath)
  }
  return destination
}
