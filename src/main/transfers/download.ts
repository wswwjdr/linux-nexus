import { dialog } from 'electron'
import { lstat as localLstat, mkdir } from 'node:fs/promises'
import { dirname, posix } from 'node:path'
import type { TransferFailure, TransferResult } from '@shared/types'
import { getMainWindow, messageFromError, sessions, type TransferItem } from '../runtime'
import { readAppSettings } from '../state-store'
import { fileType, sftpLstat } from '../sftp-utils'
import { transferFileBlocks } from './block-transfer'
import {
  assertWindowsPath,
  collectRemoteTree,
  findPathCollisions,
  localDestination,
  runTransferTasks,
} from './shared'
import { createTransferProgressReporter } from './progress'

function isLocalNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export function validateDownloadPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('至少选择一个远程文件或文件夹')
  const paths = value.map((candidate) => {
    if (typeof candidate !== 'string' || !candidate.startsWith('/')) throw new Error('下载路径必须是绝对路径')
    const path = posix.resolve('/', candidate)
    if (path === '/') throw new Error('暂不支持下载服务器根目录')
    return path
  })
  if (new Set(paths).size !== paths.length) throw new Error('下载列表包含重复路径')
  return paths
}

function failedParent(relativePath: string, blocked: Map<string, string>): string | undefined {
  let current = relativePath
  while (current && current !== '.') {
    const failure = blocked.get(current)
    if (failure) return failure
    current = posix.dirname(current)
  }
  return blocked.get('')
}

function hasChildFile(items: TransferItem[], relativePath: string): boolean {
  return items.some((item) => item.type === 'file'
    && (!relativePath || item.relativePath.startsWith(relativePath + '/')))
}

async function downloadRemoteItems(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remoteRootPath: string,
  items: TransferItem[],
  sourceFailures: TransferFailure[],
  destinationRoot: string,
  signal: AbortSignal,
): Promise<TransferResult> {
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const blockedDirectories = new Map<string, string>()
  const collisionFailures: TransferFailure[] = []
  const collidingItems = new Set<TransferItem>()
  for (const group of findPathCollisions(items, (item) => item.relativePath.toLowerCase())) {
    const message = '服务器中存在 Windows 无法区分的同名路径'
    for (const item of group) {
      collidingItems.add(item)
      collisionFailures.push({ path: item.remotePath ?? item.relativePath, message })
      if (item.type === 'directory') blockedDirectories.set(item.relativePath, message)
    }
  }
  const transferItems = items.filter((item) => !collidingItems.has(item))
  const files = transferItems.filter((item) => item.type === 'file')
  const total = files.reduce((sum, item) => sum + item.size, 0)
  const fileConcurrency = readAppSettings().transferFileConcurrency
  const progress = createTransferProgressReporter({
    sender: event.sender,
    requestId,
    sessionId,
    profileId,
    remotePath: remoteRootPath,
    direction: 'download',
    total,
    fileCount: files.length,
  })
  const directoryFailures: TransferFailure[] = []
  const directories = transferItems.filter((item) => item.type === 'directory')
    .sort((left, right) => left.relativePath.split('/').length - right.relativePath.split('/').length)

  try {
    for (const item of directories) {
      signal.throwIfAborted()
      const destination = localDestination(destinationRoot, item.relativePath)
      const parentFailure = failedParent(item.relativePath ? posix.dirname(item.relativePath) : '', blockedDirectories)
      if (parentFailure) {
        blockedDirectories.set(item.relativePath, parentFailure)
        continue
      }
      try {
        assertWindowsPath(item.relativePath)
        let attrs: Awaited<ReturnType<typeof localLstat>> | undefined
        try {
          attrs = await localLstat(destination)
        } catch (error) {
          if (!isLocalNotFound(error)) throw error
        }
        signal.throwIfAborted()
        if (attrs?.isSymbolicLink()) throw new Error('目标位置包含符号链接')
        if (attrs && !attrs.isDirectory()) throw new Error('目标位置已存在同名文件')
        if (!attrs) await mkdir(destination, { recursive: true })
      } catch (error) {
        if (signal.aborted) throw error
        const message = messageFromError(error)
        blockedDirectories.set(item.relativePath, message)
        if (!hasChildFile(transferItems, item.relativePath)) directoryFailures.push({ path: destination, message })
      }
    }

    const tasks = files.map((item) => ({
      path: item.remotePath!,
      size: item.size,
      transfer: async (requestConcurrency: number, onProgress: (bytes: number) => void) => {
        signal.throwIfAborted()
        const parentFailure = failedParent(posix.dirname(item.relativePath), blockedDirectories)
        if (parentFailure) throw new Error('目标目录不可用：' + parentFailure)
        assertWindowsPath(item.relativePath)
        const destination = localDestination(destinationRoot, item.relativePath)
        let attrs: Awaited<ReturnType<typeof localLstat>> | undefined
        try {
          attrs = await localLstat(destination)
        } catch (error) {
          if (!isLocalNotFound(error)) throw error
        }
        if (attrs?.isSymbolicLink()) throw new Error('目标位置包含符号链接')
        if (attrs && !attrs.isFile()) throw new Error('目标文件夹与待下载文件重名')
        signal.throwIfAborted()
        await mkdir(dirname(destination), { recursive: true })
        await transferFileBlocks('download', session.sftp!, item.remotePath!, destination, item.size, requestConcurrency, signal, onProgress)
      },
    }))

    const failures = [
      ...sourceFailures,
      ...collisionFailures,
      ...directoryFailures,
      ...await runTransferTasks(tasks, fileConcurrency, signal, progress),
    ]
    signal.throwIfAborted()
    return failures.length ? { status: 'completed-with-errors', failures } : { status: 'completed' }
  } finally {
    progress.flush()
  }
}

async function chooseDownloadDirectory(signal: AbortSignal): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: '选择下载位置',
    properties: ['openDirectory'],
  }
  const window = getMainWindow()
  const destination = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  signal.throwIfAborted()
  return destination.canceled || !destination.filePaths[0] ? null : destination.filePaths[0]
}

export async function downloadEntries(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remotePaths: string[],
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const destination = await chooseDownloadDirectory(signal)
  if (!destination) return { status: 'not-started' }

  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  for (const remotePath of remotePaths) {
    signal.throwIfAborted()
    const name = posix.basename(remotePath)
    try {
      const attributes = await sftpLstat(session.sftp, remotePath)
      signal.throwIfAborted()
      const type = fileType(attributes.mode)
      if (type === 'file') {
        items.push({ relativePath: name, type, size: attributes.size ?? 0, remotePath })
        continue
      }
      if (type === 'directory') {
        const collected = await collectRemoteTree(session.sftp, remotePath, signal)
        items.push(...collected.items.map((item) => ({
          ...item,
          relativePath: item.relativePath ? posix.join(name, item.relativePath) : name,
        })))
        failures.push(...collected.failures)
        continue
      }
      failures.push({
        path: remotePath,
        message: type === 'symlink' ? '不能下载符号链接' : '只能下载普通文件或文件夹',
      })
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({ path: remotePath, message: messageFromError(error) })
    }
  }

  return downloadRemoteItems(
    event,
    requestId,
    sessionId,
    profileId,
    remotePaths.length === 1 ? remotePaths[0] : `已选 ${remotePaths.length} 项`,
    items,
    failures,
    destination,
    signal,
  )
}
