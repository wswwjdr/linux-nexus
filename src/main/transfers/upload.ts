import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat as localLstat } from 'node:fs/promises'
import { basename, posix } from 'node:path'
import type { TransferResult } from '@shared/types'
import type { TransferItem } from '../runtime'
import { getMainWindow, messageFromError, sessions } from '../runtime'
import {
  collectLocalTree,
  confirmOverwrite,
  prepareRemoteDestination,
  sendTransferProgress,
  transferFile,
} from './shared'
import { fileType, isRemoteNotFound, sftpLstat, sftpMkdir, sftpRename, sftpUnlink } from '../sftp-utils'

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
  if (selection.canceled || selection.filePaths.length === 0) return 'not-started'

  const normalizedDirectory = posix.resolve('/', remoteDirectory || '/')
  const directoryAttributes = await sftpLstat(session.sftp, normalizedDirectory)
  if (fileType(directoryAttributes.mode) !== 'directory') throw new Error('上传目标不是文件夹')

  let remoteRoot = normalizedDirectory
  let items: TransferItem[]
  if (uploadFolder) {
    const localRoot = selection.filePaths[0]
    items = await collectLocalTree(localRoot, signal)
    remoteRoot = posix.join(normalizedDirectory, basename(localRoot))
  } else {
    items = []
    for (const localPath of selection.filePaths) {
      signal.throwIfAborted()
      const attrs = await localLstat(localPath)
      if (attrs.isSymbolicLink()) throw new Error('不能上传符号链接：' + localPath)
      if (!attrs.isFile()) throw new Error('只能上传普通文件：' + localPath)
      items.push({ relativePath: basename(localPath), type: 'file', size: attrs.size, localPath })
    }
  }

  signal.throwIfAborted()
  const { collisions, existingDirectories } = await prepareRemoteDestination(session.sftp, items, remoteRoot)
  signal.throwIfAborted()
  if (!await confirmOverwrite(collisions, '上传')) return 'not-started'
  signal.throwIfAborted()

  const collisionSet = new Set(collisions)
  const total = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)
  let completed = 0

  for (const item of items) {
    signal.throwIfAborted()
    const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
    if (item.type === 'directory') {
      if (!existingDirectories.has(destination)) await sftpMkdir(session.sftp, destination)
      signal.throwIfAborted()
      continue
    }

    const temporaryPath = posix.join(posix.dirname(destination), '.' + posix.basename(destination) + '.' + randomUUID() + '.upload')
    let committed = false
    try {
      await transferFile('put', session.sftp, item.localPath!, temporaryPath, signal, (transferred) => {
        sendTransferProgress(event.sender, requestId, sessionId, profileId, destination, 'upload', completed + transferred, total)
      })
      signal.throwIfAborted()
      const backupPath = collisionSet.has(destination)
        ? posix.join(posix.dirname(destination), '.' + posix.basename(destination) + '.' + randomUUID() + '.backup')
        : null
      if (backupPath) await sftpRename(session.sftp, destination, backupPath)
      try {
        signal.throwIfAborted()
        await sftpRename(session.sftp, temporaryPath, destination)
      } catch (error) {
        if (backupPath) {
          try {
            await sftpRename(session.sftp, backupPath, destination)
          } catch (restoreError) {
            throw new Error(messageFromError(error) + '；旧文件恢复失败，备份保留在 ' + backupPath + '：' + messageFromError(restoreError))
          }
        }
        throw error
      }
      committed = true
      if (backupPath) {
        try {
          await sftpUnlink(session.sftp, backupPath)
        } catch (error) {
          throw new Error('上传已完成，但无法清理旧文件备份 ' + backupPath + '：' + messageFromError(error))
        }
      }
    } finally {
      if (!committed) {
        try {
          await sftpUnlink(session.sftp, temporaryPath)
        } catch (error) {
          if (!isRemoteNotFound(error)) {
            throw new Error('未完成的上传文件无法清理 ' + temporaryPath + '：' + messageFromError(error))
          }
        }
      }
    }
    completed += item.size
    sendTransferProgress(event.sender, requestId, sessionId, profileId, destination, 'upload', completed, total)
  }
  signal.throwIfAborted()
  return 'completed'
}
