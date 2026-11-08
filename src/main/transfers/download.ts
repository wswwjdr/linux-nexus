import { type MessageValue, msg, tr, LocalizedError } from '../../shared/i18n/messages'
import { dialog } from 'electron'
import { lstat as localLstat, mkdir } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import type { TransferFailure, TransferResult } from '@shared/types'
import { getMainWindow, messageFromError, type TransferItem } from '../runtime'
import { readAppSettings } from '../state-store'
import { iterateRemoteTree, filesSession, remotePathType, remoteFileSize } from '../remote-fs'
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
  if (!Array.isArray(value) || value.length === 0) throw new LocalizedError(msg('errors.selectAtLeastOneRemoteFileOrFolder'))
  const paths = value.map((candidate) => {
    if (typeof candidate !== 'string' || !candidate.startsWith('/')) throw new LocalizedError(msg('errors.downloadPathsMustBeAbsolute'))
    const path = posix.resolve('/', candidate)
    if (path === '/') throw new LocalizedError(msg('errors.downloadingTheServerRootDirectoryIsNotSupported'))
    return path
  })
  if (new Set(paths).size !== paths.length) throw new LocalizedError(msg('errors.downloadListContainsDuplicatePaths'))
  return paths
}

function failedParent(relativePath: string, blocked: Map<string, MessageValue>): MessageValue | undefined {
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
  session: ReturnType<typeof filesSession>,
  remoteRootPath: string,
  items: TransferItem[],
  sourceFailures: TransferFailure[],
  destinationRoot: string,
  signal: AbortSignal,
): Promise<TransferResult> {
  const { sessionId, profileId } = session
  const blockedDirectories = new Map<string, MessageValue>()
  const collisionFailures: TransferFailure[] = []
  const collidingItems = new Set<TransferItem>()
  for (const group of findPathCollisions(items, (item) => item.relativePath.toLowerCase())) {
    const message = msg('errors.serverContainsPathsThatWindowsCannotDistinguish')
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
        if (attrs?.isSymbolicLink()) throw new LocalizedError(msg('errors.destinationContainsASymbolicLink'))
        if (attrs && !attrs.isDirectory()) throw new LocalizedError(msg('errors.aFileWithTheSameNameAlreadyExistsAtThe'))
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
        if (parentFailure) throw new LocalizedError(msg('errors.destinationDirectoryIsUnavailable', { "parentFailure": parentFailure }))
        assertWindowsPath(item.relativePath)
        const destination = localDestination(destinationRoot, item.relativePath)
        let attrs: Awaited<ReturnType<typeof localLstat>> | undefined
        try {
          attrs = await localLstat(destination)
        } catch (error) {
          if (!isLocalNotFound(error)) throw error
        }
        if (attrs?.isSymbolicLink()) throw new LocalizedError(msg('errors.destinationContainsASymbolicLink'))
        if (attrs && !attrs.isFile()) throw new LocalizedError(msg('errors.destinationFolderHasTheSameNameAsAFileBeing'))
        signal.throwIfAborted()
        await mkdir(dirname(destination), { recursive: true })
        await transferFileStream('download', session.commands, item.remotePath!, destination, item.size, signal, onProgress)
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
    title: tr('errors.chooseDownloadLocation'),
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
  session: ReturnType<typeof filesSession>,
  remotePaths: string[],
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const destination = await chooseDownloadDirectory(signal)
  if (!destination) return { status: 'not-started' }

  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  const reservedNames = new Set<string>()
  for (const remotePath of remotePaths) {
    signal.throwIfAborted()
    const originalName = posix.basename(remotePath)
    try {
      assertWindowsPath(originalName)
      let name = await uniqueDownloadName(destination, originalName, reservedNames)
      reservedNames.add(name.toLowerCase())
      const type = await remotePathType(session.commands, remotePath)
      if (type === 'file') {
        items.push({ relativePath: name, type, size: await remoteFileSize(session.commands, remotePath), remotePath })
        continue
      }
      if (type === 'directory') {
        // Reserve a directory name exclusively, including between different server queues.
        for (;;) {
          try { await mkdir(join(destination, name)); break }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            name = await uniqueDownloadName(destination, originalName, reservedNames)
            reservedNames.add(name.toLowerCase())
          }
        }
        for await (const item of iterateRemoteTree(session.commands, remotePath, signal)) {
          if (item.type === 'file' || item.type === 'directory') items.push({ ...item, type: item.type, relativePath: item.relativePath ? posix.join(name, item.relativePath) : name })
          else failures.push({ path: item.remotePath, message: item.type === 'symlink' ? msg('errors.folderContainsSymbolicLinksAndCannotBeDownloaded') : msg('errors.folderContainsUnsupportedFileTypes') })
        }
        continue
      }
      failures.push({
        path: remotePath,
        message: type === 'symlink' ? msg('errors.cannotDownloadSymbolicLinks') : msg('errors.onlyRegularFilesOrFoldersCanBeDownloaded'),
      })
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({ path: remotePath, message: messageFromError(error) })
    }
  }

  return downloadRemoteItems(
    event,
    requestId,
    session,
    remotePaths[0],
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
