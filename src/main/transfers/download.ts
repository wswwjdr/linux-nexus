import { app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import type { TransferResult } from '@shared/types'
import { getMainWindow, messageFromError, sessions, type TransferItem } from '../runtime'
import { fileType, sftpLstat } from '../sftp-utils'
import {
  assertWindowsPath,
  collectRemoteTree,
  confirmOverwrite,
  localDestination,
  prepareLocalDestination,
  sendTransferProgress,
  transferFile,
} from './shared'

async function removeTemporaryFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error('未完成的下载文件无法清理 ' + filePath + '：' + messageFromError(error))
    }
  }
}

async function publishDownloadedFile(
  temporaryPath: string,
  destination: string,
  onCommitted: () => void,
): Promise<void> {
  try {
    await rename(temporaryPath, destination)
    onCommitted()
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
  }

  const destinationTemporaryPath = join(
    dirname(destination),
    '.' + basename(destination) + '.' + randomUUID() + '.download',
  )
  let committed = false
  try {
    await copyFile(temporaryPath, destinationTemporaryPath, constants.COPYFILE_EXCL)
    await rename(destinationTemporaryPath, destination)
    committed = true
    onCommitted()
  } finally {
    if (!committed) await removeTemporaryFile(destinationTemporaryPath)
  }
  await removeTemporaryFile(temporaryPath)
}

async function downloadRemoteItems(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  profileId: string,
  items: TransferItem[],
  destinationRoot: string,
  signal: AbortSignal,
): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const total = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)
  const temporaryDirectory = join(app.getPath('temp'), 'linux-nexus-downloads')
  await mkdir(temporaryDirectory, { recursive: true })
  let completed = 0

  for (const item of items) {
    signal.throwIfAborted()
    const destination = localDestination(destinationRoot, item.relativePath)
    if (item.type === 'directory') {
      await mkdir(destination, { recursive: true })
      signal.throwIfAborted()
      continue
    }

    await mkdir(dirname(destination), { recursive: true })
    const temporaryPath = join(temporaryDirectory, randomUUID() + '.download')
    let committed = false
    try {
      await transferFile('get', session.sftp, item.remotePath!, temporaryPath, signal, (transferred) => {
        sendTransferProgress(event.sender, requestId, profileId, item.remotePath!, 'download', completed + transferred, total)
      })
      signal.throwIfAborted()
      await publishDownloadedFile(temporaryPath, destination, () => { committed = true })
    } finally {
      if (!committed) await removeTemporaryFile(temporaryPath)
    }
    completed += item.size
    sendTransferProgress(event.sender, requestId, profileId, item.remotePath!, 'download', completed, total)
  }
}

export async function downloadEntry(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  profileId: string,
  remotePath: string,
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const attributes = await sftpLstat(session.sftp, normalizedPath)
  signal.throwIfAborted()
  const type = fileType(attributes.mode)
  if (type === 'symlink') throw new Error('不能下载符号链接：' + normalizedPath)

  if (type === 'file') {
    const destination = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
      title: '选择文件下载位置',
      properties: ['openDirectory'],
    })
    signal.throwIfAborted()
    if (destination.canceled || !destination.filePaths[0]) return 'not-started'
    const fileName = posix.basename(normalizedPath)
    assertWindowsPath(fileName)
    const localPath = join(destination.filePaths[0], fileName)
    const item: TransferItem = { relativePath: '', type: 'file', size: attributes.size ?? 0, remotePath: normalizedPath }
    const collisions = await prepareLocalDestination([item], localPath)
    signal.throwIfAborted()
    if (!await confirmOverwrite(collisions, '下载')) return 'not-started'
    signal.throwIfAborted()
    await downloadRemoteItems(event, requestId, profileId, [item], localPath, signal)
    signal.throwIfAborted()
    return 'completed'
  }

  if (type !== 'directory') throw new Error('只能下载普通文件或文件夹')
  if (normalizedPath === '/') throw new Error('暂不支持下载服务器根目录')
  const destination = await dialog.showOpenDialog(getMainWindow() ?? undefined, {
    title: '选择文件夹下载位置',
    properties: ['openDirectory'],
  })
  signal.throwIfAborted()
  if (destination.canceled || !destination.filePaths[0]) return 'not-started'

  const folderName = posix.basename(normalizedPath)
  assertWindowsPath(folderName)
  const localRoot = join(destination.filePaths[0], folderName)
  const items = await collectRemoteTree(session.sftp, normalizedPath, signal)
  const collisions = await prepareLocalDestination(items, localRoot)
  signal.throwIfAborted()
  if (!await confirmOverwrite(collisions, '下载')) return 'not-started'
  signal.throwIfAborted()
  await downloadRemoteItems(event, requestId, profileId, items, localRoot, signal)
  signal.throwIfAborted()
  return 'completed'
}
