import { dialog } from 'electron'
import { createReadStream as localCreateReadStream, createWriteStream } from 'node:fs'
import { lstat as localLstat, readdir as localReaddir } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import type { TransferProgress, TransferResult } from '@shared/types'
import { activeTransfers, getMainWindow, sessions, type TransferItem } from '../runtime'
import {
  fileType,
  isRemoteNotFound,
  remoteAttributesOrNull,
  sftpLstat,
  sftpMkdir,
  sftpReaddir,
  sftpRename,
  sftpUnlink,
} from '../sftp-utils'
import type { SFTPWrapper } from 'ssh2'

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) return error.name === 'AbortError' || (error as NodeJS.ErrnoException).code === 'ABORT_ERR'
  if (typeof error !== 'object' || error === null) return false
  return ('name' in error && error.name === 'AbortError') || ('code' in error && error.code === 'ABORT_ERR')
}

export function transferFile(
  operation: 'get' | 'put',
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationPath: string,
  signal: AbortSignal,
  onProgress: (transferred: number) => void,
): Promise<void> {
  let transferred = 0
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length
      onProgress(transferred)
      callback(null, chunk)
    },
  })
  const source = operation === 'get' ? sftp.createReadStream(sourcePath) : localCreateReadStream(sourcePath)
  const destination = operation === 'get'
    ? createWriteStream(destinationPath, { flags: 'wx' })
    : sftp.createWriteStream(destinationPath, { flags: 'wx' })
  return pipeline(source, progress, destination, { signal }).then(() => undefined)
}

export async function collectRemoteTree(sftp: SFTPWrapper, remoteRoot: string, signal: AbortSignal): Promise<TransferItem[]> {
  const items: TransferItem[] = []
  const visit = async (remotePath: string, relativePath: string, attrs: Awaited<ReturnType<typeof sftpLstat>>) => {
    signal.throwIfAborted()
    const type = fileType(attrs.mode)
    if (type === 'symlink') throw new Error('目录包含符号链接，无法传输：' + remotePath)
    if (type === 'other') throw new Error('目录包含暂不支持的文件类型：' + remotePath)
    items.push({ relativePath, type, size: attrs.size ?? 0, remotePath })
    if (type !== 'directory') return
    const entries = await sftpReaddir(sftp, remotePath)
    for (const entry of entries) {
      signal.throwIfAborted()
      if (entry.filename === '.' || entry.filename === '..') continue
      const childPath = posix.join(remotePath, entry.filename)
      const childRelativePath = relativePath ? posix.join(relativePath, entry.filename) : entry.filename
      await visit(childPath, childRelativePath, entry.attrs)
    }
  }
  await visit(remoteRoot, '', await sftpLstat(sftp, remoteRoot))
  return items
}

export async function collectLocalTree(localRoot: string, signal: AbortSignal): Promise<TransferItem[]> {
  const items: TransferItem[] = []
  const visit = async (localPath: string, relativePath: string) => {
    signal.throwIfAborted()
    const attrs = await localLstat(localPath)
    if (attrs.isSymbolicLink()) throw new Error('目录包含符号链接，无法传输：' + localPath)
    if (attrs.isDirectory()) {
      items.push({ relativePath, type: 'directory', size: 0, localPath })
      const entries = await localReaddir(localPath, { withFileTypes: true })
      for (const entry of entries) {
        signal.throwIfAborted()
        const childPath = join(localPath, entry.name)
        const childRelativePath = relativePath ? posix.join(relativePath, entry.name) : entry.name
        await visit(childPath, childRelativePath)
      }
      return
    }
    if (!attrs.isFile()) throw new Error('目录包含暂不支持的文件类型：' + localPath)
    items.push({ relativePath, type: 'file', size: attrs.size, localPath })
  }
  await visit(localRoot, '')
  return items
}

export function assertWindowsPath(relativePath: string): void {
  for (const name of relativePath.split(/[\/\\]/)) {
    if (!name) continue
    if (/[<>:"\/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
      throw new Error('Windows 不支持此文件名，无法下载：' + name)
    }
  }
}

export async function confirmOverwrite(collisions: string[], operation: string): Promise<boolean> {
  if (!collisions.length) return true
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    title: '确认覆盖文件',
    message: '本次' + operation + '发现 ' + collisions.length + ' 个同名文件。',
    detail: '继续后会覆盖这些文件；同名文件夹会合并。',
    buttons: ['取消传输', '覆盖并继续'],
    defaultId: 0,
    cancelId: 0,
  }
  const window = getMainWindow()
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  return result.response === 1
}

export async function withTransferLock(
  profileId: string,
  sessionId: string,
  requestId: string,
  operation: (signal: AbortSignal) => Promise<TransferResult>,
): Promise<TransferResult> {
  if ([...activeTransfers.values()].some((transfer) => transfer.profileId === profileId)) {
    throw new Error('此服务器已有文件传输正在进行')
  }
  if (activeTransfers.has(requestId)) throw new Error('传输请求标识重复')
  const transfer = { profileId, sessionId, controller: new AbortController(), settled: Promise.resolve() }
  activeTransfers.set(requestId, transfer)
  try {
    const operationPromise = operation(transfer.controller.signal)
    transfer.settled = operationPromise.then(() => undefined, () => undefined)
    return await operationPromise
  } catch (error) {
    if (transfer.controller.signal.aborted && isAbortError(error)) return 'cancelled'
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

export function sendTransferProgress(
  sender: Electron.WebContents,
  requestId: string,
  sessionId: string,
  profileId: string,
  remotePath: string,
  direction: TransferProgress['direction'],
  transferred: number,
  total: number,
): void {
  if (sender.isDestroyed()) return
  sender.send('files:transfer-progress', { requestId, sessionId, profileId, remotePath, direction, transferred, total } satisfies TransferProgress)
}

export async function prepareLocalDestination(items: TransferItem[], destinationRoot: string): Promise<string[]> {
  const collisions: string[] = []
  const pathKeys = new Set<string>()
  for (const item of items) {
    assertWindowsPath(item.relativePath)
    const pathKey = item.relativePath.replace(/\\/g, '/').toLowerCase()
    if (pathKeys.has(pathKey)) throw new Error('服务器中存在 Windows 无法区分的同名路径：' + item.relativePath)
    pathKeys.add(pathKey)
    const destination = localDestination(destinationRoot, item.relativePath)
    let attrs: Awaited<ReturnType<typeof localLstat>>
    try {
      attrs = await localLstat(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (attrs.isSymbolicLink()) throw new Error('目标位置包含符号链接，无法传输：' + destination)
    if (item.type === 'directory' && !attrs.isDirectory()) {
      throw new Error('目标文件与待下载文件夹重名：' + destination)
    }
    if (item.type === 'file' && !attrs.isFile()) {
      throw new Error('目标文件夹与待下载文件重名：' + destination)
    }
    if (item.type === 'file') collisions.push(destination)
  }
  return collisions
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

export async function prepareRemoteDestination(
  sftp: SFTPWrapper,
  items: TransferItem[],
  remoteRoot: string,
): Promise<{ collisions: string[]; existingDirectories: Set<string> }> {
  const collisions: string[] = []
  const existingDirectories = new Set<string>()
  const targetPaths = new Set<string>()
  for (const item of items) {
    const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
    if (targetPaths.has(destination)) throw new Error('本次选择包含重名文件：' + destination)
    targetPaths.add(destination)
    const attrs = await remoteAttributesOrNull(sftp, destination)
    if (!attrs) continue
    const type = fileType(attrs.mode)
    if (type === 'symlink') throw new Error('目标位置包含符号链接，无法传输：' + destination)
    if (item.type === 'directory' && type !== 'directory') {
      throw new Error('目标文件与待上传文件夹重名：' + destination)
    }
    if (item.type === 'file' && type !== 'file') {
      throw new Error('目标文件夹与待上传文件重名：' + destination)
    }
    if (item.type === 'directory') existingDirectories.add(destination)
    else collisions.push(destination)
  }
  return { collisions, existingDirectories }
}
