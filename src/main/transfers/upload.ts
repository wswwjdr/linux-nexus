import { dialog } from 'electron'
import { lstat as localLstat } from 'node:fs/promises'
import { basename, isAbsolute, posix } from 'node:path'
import type { TransferFailure, TransferResult } from '@shared/types'
import type { TransferItem } from '../runtime'
import { getMainWindow, messageFromError, sessions } from '../runtime'
import { readAppSettings } from '../state-store'
import { fileType, remoteAttributesOrNull, sftpLstat, sftpMkdir } from '../sftp-utils'
import { transferFileBlocks } from './block-transfer'
import {
  collectLocalTree,
  findPathCollisions,
  runTransferTasks,
} from './shared'
import { createTransferProgressReporter } from './progress'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function droppedRelativePath(value: unknown): string {
  if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')
    || posix.isAbsolute(value) || isAbsolute(value)) {
    throw new Error('拖入的文件路径无效')
  }
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    throw new Error('拖入的文件路径无效')
  }
  return value
}

async function prepareDroppedItems(entries: unknown, signal: AbortSignal): Promise<{ items: TransferItem[]; failures: TransferFailure[] }> {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('拖入内容中没有可上传的文件或文件夹')

  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  const itemsByPath = new Map<string, TransferItem>()
  const seenPaths = new Set<string>()
  for (const entry of entries) {
    signal.throwIfAborted()
    if (!isRecord(entry)) throw new Error('拖入的文件清单无效')
    const relativePath = droppedRelativePath(entry.relativePath)
    if (seenPaths.has(relativePath)) throw new Error('拖入内容包含重名路径：' + relativePath)
    seenPaths.add(relativePath)

    let item: TransferItem
    if (entry.type === 'directory') {
      item = { relativePath, type: 'directory', size: 0 }
    } else if (entry.type === 'file') {
      const localPath = entry.localPath
      if (typeof localPath !== 'string' || !isAbsolute(localPath)) throw new Error('拖入文件的本机路径无效')
      let attributes: Awaited<ReturnType<typeof localLstat>>
      try {
        attributes = await localLstat(localPath)
      } catch (error) {
        if (signal.aborted) throw error
        failures.push({ path: localPath, message: messageFromError(error) })
        continue
      }
      if (attributes.isSymbolicLink()) {
        failures.push({ path: localPath, message: '不能上传符号链接' })
        continue
      }
      if (!attributes.isFile()) {
        failures.push({ path: localPath, message: '只能上传普通文件' })
        continue
      }
      if (basename(localPath).toLowerCase() !== relativePath.split('/').pop()!.toLowerCase()) {
        throw new Error('拖入文件的名称与路径不一致：' + localPath)
      }
      item = { relativePath, type: 'file', size: attributes.size, localPath }
    } else {
      throw new Error('拖入内容包含暂不支持的文件类型')
    }

    items.push(item)
    itemsByPath.set(relativePath, item)
  }

  for (const item of items) {
    const parts = item.relativePath.split('/')
    for (let index = 1; index < parts.length; index += 1) {
      const parentPath = parts.slice(0, index).join('/')
      if (itemsByPath.get(parentPath)?.type !== 'directory') {
        throw new Error('拖入的文件夹结构无效：' + item.relativePath)
      }
    }
  }

  return { items: items.sort((left, right) => {
    const depthDifference = left.relativePath.split('/').length - right.relativePath.split('/').length
    if (depthDifference !== 0) return depthDifference
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
    return left.relativePath.localeCompare(right.relativePath)
  }), failures }
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

async function uploadItems(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remoteDirectory: string,
  remoteRoot: string,
  items: TransferItem[],
  sourceFailures: TransferFailure[],
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')

  const normalizedDirectory = posix.resolve('/', remoteDirectory || '/')
  const directoryAttributes = await sftpLstat(session.sftp, normalizedDirectory)
  if (fileType(directoryAttributes.mode) !== 'directory') throw new Error('上传目标不是文件夹')

  signal.throwIfAborted()
  const fileConcurrency = readAppSettings().transferFileConcurrency
  const blockedDirectories = new Map<string, string>()
  const collisionFailures: TransferFailure[] = []
  const collidingItems = new Set<TransferItem>()
  for (const group of findPathCollisions(items, (item) => item.relativePath)) {
    const message = '本次传输包含重复目标路径'
    for (const item of group) {
      collidingItems.add(item)
      collisionFailures.push({
        path: item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot,
        message,
      })
    }
    if (group.some((item) => item.type === 'directory')) blockedDirectories.set(group[0].relativePath, message)
  }
  const files = items.filter((item) => item.type === 'file' && !collidingItems.has(item))
  const total = files.reduce((sum, item) => sum + item.size, 0)
  const progress = createTransferProgressReporter({
    sender: event.sender,
    requestId,
    sessionId,
    profileId,
    remotePath: remoteRoot,
    direction: 'upload',
    total,
    fileCount: files.length,
  })
  const directoryFailures: TransferFailure[] = []
  const directories = items.filter((item) => item.type === 'directory')
    .sort((left, right) => left.relativePath.split('/').length - right.relativePath.split('/').length)

  try {
    for (const item of directories) {
      signal.throwIfAborted()
      const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
      if (blockedDirectories.has(item.relativePath)) continue
      const parentFailure = failedParent(item.relativePath ? posix.dirname(item.relativePath) : '', blockedDirectories)
      if (parentFailure) {
        blockedDirectories.set(item.relativePath, parentFailure)
        continue
      }
      try {
        const attrs = await remoteAttributesOrNull(session.sftp, destination)
        signal.throwIfAborted()
        if (attrs) {
          const type = fileType(attrs.mode)
          if (type === 'symlink') throw new Error('目标位置包含符号链接')
          if (type !== 'directory') throw new Error('目标位置已存在同名文件')
        } else {
          await sftpMkdir(session.sftp, destination)
        }
      } catch (error) {
        if (signal.aborted) throw error
        const message = messageFromError(error)
        blockedDirectories.set(item.relativePath, message)
        if (!hasChildFile(items, item.relativePath)) directoryFailures.push({ path: destination, message })
      }
    }

    const tasks = files.map((item) => {
      const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
      return {
        path: destination,
        size: item.size,
        transfer: async (requestConcurrency: number, onProgress: (bytes: number) => void) => {
          signal.throwIfAborted()
          const parentFailure = failedParent(posix.dirname(item.relativePath), blockedDirectories)
          if (parentFailure) throw new Error('目标目录不可用：' + parentFailure)
          const attrs = await remoteAttributesOrNull(session.sftp!, destination)
          if (attrs) {
            const type = fileType(attrs.mode)
            if (type === 'symlink') throw new Error('目标位置包含符号链接')
            if (type !== 'file') throw new Error('目标文件夹与待上传文件重名')
          }
          signal.throwIfAborted()
          await transferFileBlocks('upload', session.sftp!, item.localPath!, destination, item.size, requestConcurrency, signal, onProgress)
        },
      }
    })
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

export async function uploadSelection(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remoteDirectory: string,
  uploadFolder: boolean,
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const options: Electron.OpenDialogOptions = uploadFolder
    ? { title: '选择要上传的文件夹', properties: ['openDirectory'] }
    : { title: '选择要上传的文件', properties: ['openFile', 'multiSelections'] }
  const window = getMainWindow()
  const selection = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  signal.throwIfAborted()
  if (selection.canceled || selection.filePaths.length === 0) return { status: 'not-started' }

  const normalizedDirectory = posix.resolve('/', remoteDirectory || '/')
  let remoteRoot = normalizedDirectory
  let items: TransferItem[]
  let sourceFailures: TransferFailure[] = []
  if (uploadFolder) {
    const localRoot = selection.filePaths[0]
    const collected = await collectLocalTree(localRoot, signal)
    items = collected.items
    sourceFailures = collected.failures
    remoteRoot = posix.join(normalizedDirectory, basename(localRoot))
  } else {
    items = []
    for (const localPath of selection.filePaths) {
      signal.throwIfAborted()
      try {
        const attrs = await localLstat(localPath)
        if (attrs.isSymbolicLink()) {
          sourceFailures.push({ path: localPath, message: '不能上传符号链接' })
        } else if (!attrs.isFile()) {
          sourceFailures.push({ path: localPath, message: '只能上传普通文件' })
        } else {
          items.push({ relativePath: basename(localPath), type: 'file', size: attrs.size, localPath })
        }
      } catch (error) {
        if (signal.aborted) throw error
        sourceFailures.push({ path: localPath, message: messageFromError(error) })
      }
    }
  }

  return uploadItems(event, requestId, sessionId, profileId, remoteDirectory, remoteRoot, items, sourceFailures, signal)
}

export async function uploadDroppedEntries(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remoteDirectory: string,
  entries: unknown,
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const collected = await prepareDroppedItems(entries, signal)
  const remoteRoot = posix.resolve('/', remoteDirectory || '/')
  return uploadItems(event, requestId, sessionId, profileId, remoteDirectory, remoteRoot, collected.items, collected.failures, signal)
}
