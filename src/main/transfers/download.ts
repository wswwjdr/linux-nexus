import { dialog } from 'electron'
import { lstat as localLstat, mkdir } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
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

export async function downloadEntry(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remotePath: string,
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const attributes = await sftpLstat(session.sftp, normalizedPath)
  signal.throwIfAborted()
  const type = fileType(attributes.mode)
  if (type === 'symlink') throw new Error('不能下载符号链接：' + normalizedPath)

  if (type === 'file') {
    const options: Electron.OpenDialogOptions = {
      title: '选择文件下载位置',
      properties: ['openDirectory'],
    }
    const window = getMainWindow()
    const destination = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    signal.throwIfAborted()
    if (destination.canceled || !destination.filePaths[0]) return { status: 'not-started' }
    const fileName = posix.basename(normalizedPath)
    assertWindowsPath(fileName)
    const localPath = join(destination.filePaths[0], fileName)
    const item: TransferItem = { relativePath: '', type: 'file', size: attributes.size ?? 0, remotePath: normalizedPath }
    return downloadRemoteItems(event, requestId, sessionId, profileId, normalizedPath, [item], [], localPath, signal)
  }

  if (type !== 'directory') throw new Error('只能下载普通文件或文件夹')
  if (normalizedPath === '/') throw new Error('暂不支持下载服务器根目录')
  const options: Electron.OpenDialogOptions = {
    title: '选择文件夹下载位置',
    properties: ['openDirectory'],
  }
  const window = getMainWindow()
  const destination = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  signal.throwIfAborted()
  if (destination.canceled || !destination.filePaths[0]) return { status: 'not-started' }

  const folderName = posix.basename(normalizedPath)
  assertWindowsPath(folderName)
  const localRoot = join(destination.filePaths[0], folderName)
  const collected = await collectRemoteTree(session.sftp, normalizedPath, signal)
  return downloadRemoteItems(event, requestId, sessionId, profileId, normalizedPath, collected.items, collected.failures, localRoot, signal)
}
