import { dialog } from 'electron'
import { lstat as localLstat, mkdir } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import type { TransferFailure, TransferResult } from '@shared/types'
import { getMainWindow, messageFromError, type TransferItem } from '../runtime'
import { readAppSettings } from '../state-store'
import { collectRemoteTree as collectRemoteTreeEntries, filesSession, remotePathType, remoteFileSize } from '../remote-fs'
import { transferFileStream } from './stream-transfer'
import {
  assertWindowsPath,
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
  const session = filesSession(sessionId)
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
      transfer: async (onProgress: (bytes: number) => void) => {
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
        await transferFileStream('download', session.client, item.remotePath!, destination, item.size, signal, onProgress)
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
  const session = filesSession(sessionId)
  const destination = await chooseDownloadDirectory(signal)
  if (!destination) return { status: 'not-started' }

  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  const reservedNames = new Set<string>()
  for (const remotePath of remotePaths) {
    signal.throwIfAborted()
    const originalName = posix.basename(remotePath)
    const name = await uniqueDownloadName(destination, originalName, reservedNames)
    reservedNames.add(name.toLowerCase())
    try {
      const type = await remotePathType(session.client, remotePath)
      if (type === 'file') {
        items.push({ relativePath: name, type, size: await remoteFileSize(session.client, remotePath), remotePath })
        continue
      }
      if (type === 'directory') {
        const collected = await collectRemoteTreeEntries(session.client, remotePath, signal)
        items.push(...collected.filter((item) => item.type === 'file' || item.type === 'directory').map((item) => ({
          ...item,
          type: item.type as 'file' | 'directory',
          relativePath: item.relativePath ? posix.join(name, item.relativePath) : name,
        })))
        failures.push(...collected.filter((item) => item.type === 'symlink' || item.type === 'other').map((item) => ({
          path: item.remotePath,
          message: item.type === 'symlink' ? '目录包含符号链接，无法下载' : '目录包含暂不支持的文件类型',
        })))
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

export async function uniqueDownloadName(directory: string, originalName: string, reserved: Set<string>): Promise<string> {
  const extensionIndex = originalName.lastIndexOf('.')
  const stem = extensionIndex > 0 ? originalName.slice(0, extensionIndex) : originalName
  const extension = extensionIndex > 0 ? originalName.slice(extensionIndex) : ''
  for (let index = 0; ; index += 1) {
    const candidate = index === 0 ? originalName : `${stem} (${index})${extension}`
    if (reserved.has(candidate.toLowerCase())) continue
    try {
      await localLstat(join(directory, candidate))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw error
    }
  }
}
