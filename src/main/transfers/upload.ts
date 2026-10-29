import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat as localLstat } from 'node:fs/promises'
import { basename, isAbsolute, posix } from 'node:path'
import type { OperationExecutionStrategy, TransferFailure, TransferResult, UploadSelection, UploadSelectionRequest } from '@shared/types'
import type { TransferItem } from '../runtime'
import { getMainWindow, messageFromError } from '../runtime'
import { readAppSettings } from '../state-store'
import { filesSession, normalizedRemotePath } from '../remote-fs'
import { buildRemoteCommand, runRemoteCommand } from '../ssh-commands'
import { transferFileStream } from './stream-transfer'
import { uploadMoveFlag } from './upload-strategy'
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
      item = { relativePath, type: 'file', size: attributes.size, modifiedAtMs: attributes.mtimeMs, localPath }
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

interface StoredUploadSelection {
  selection: UploadSelection
  items: TransferItem[]
  expiresAt: number
}

interface UploadSources {
  remoteRoot: string
  name: string
  items: TransferItem[]
  failures: TransferFailure[]
}

const uploadSelections = new Map<string, StoredUploadSelection>()
const UPLOAD_SELECTION_TTL_MS = 10 * 60_000

function pruneUploadSelections(): void {
  const now = Date.now()
  for (const [id, selection] of uploadSelections) {
    if (selection.expiresAt <= now) uploadSelections.delete(id)
  }
}

async function collectUploadSources(request: UploadSelectionRequest, signal: AbortSignal): Promise<UploadSources | null> {
  const remoteDirectory = normalizedRemotePath(request.remoteDirectory || '/')
  if (request.mode === 'drop') {
    if (!Array.isArray(request.entries)) throw new Error('拖入文件清单无效')
    const collected = await prepareDroppedItems(request.entries, signal)
    return { remoteRoot: remoteDirectory, name: '拖放上传', items: collected.items, failures: collected.failures }
  }
  if (request.entries !== undefined) throw new Error('上传来源参数无效')

  const uploadFolder = request.mode === 'folder'
  const options: Electron.OpenDialogOptions = uploadFolder
    ? { title: '选择要上传的文件夹', properties: ['openDirectory'] }
    : { title: '选择要上传的文件', properties: ['openFile', 'multiSelections'] }
  const window = getMainWindow()
  const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  signal.throwIfAborted()
  if (selection.canceled || selection.filePaths.length === 0) return null

  if (uploadFolder) {
    const localRoot = selection.filePaths[0]
    const collected = await collectLocalTree(localRoot, signal)
    return {
      remoteRoot: posix.join(remoteDirectory, basename(localRoot)),
      name: basename(localRoot),
      items: collected.items,
      failures: collected.failures,
    }
  }

  const items: TransferItem[] = []
  const failures: TransferFailure[] = []
  for (const localPath of selection.filePaths) {
    signal.throwIfAborted()
    try {
      const attrs = await localLstat(localPath)
      if (attrs.isSymbolicLink()) failures.push({ path: localPath, message: '不能上传符号链接' })
      else if (!attrs.isFile()) failures.push({ path: localPath, message: '只能上传普通文件' })
      else items.push({ relativePath: basename(localPath), type: 'file', size: attrs.size, modifiedAtMs: attrs.mtimeMs, localPath })
    } catch (error) {
      if (signal.aborted) throw error
      failures.push({ path: localPath, message: messageFromError(error) })
    }
  }
  return { remoteRoot: remoteDirectory, name: selection.filePaths.length === 1 ? basename(selection.filePaths[0]) : `上传 ${items.length} 项`, items, failures }
}

function uploadCommandPreview(targetPath: string, strategy: OperationExecutionStrategy): string {
  const moveFlag = uploadMoveFlag(strategy)
  const script = [
    'set -eu',
    'destination=$1; modified=$2',
    'directory=$(dirname -- "$destination"); name=$(basename -- "$destination")',
    'temporary=$(mktemp -- "$directory/.$name.linux-nexus.XXXXXX")',
    'trap \'rm -f -- "$temporary"\' EXIT',
    'trap \'exit 129\' HUP',
    'trap \'exit 130\' INT',
    'trap \'exit 143\' TERM',
    'cat > "$temporary"',
    'touch -d "@$modified" -- "$temporary"',
    `mv ${moveFlag} -- "$temporary" "$destination"`,
    '[[ ! -e "$temporary" ]] || rm -f -- "$temporary"',
    'trap - EXIT HUP INT TERM',
  ].join('\n')
  return buildRemoteCommand(script, [targetPath, '本机修改时间'])
}

export async function selectUploadSources(value: unknown): Promise<UploadSelection | null> {
  if (!isRecord(value)
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || typeof value.remoteDirectory !== 'string'
    || !['files', 'folder', 'drop'].includes(value.mode as string)
    || !['force', 'skip', 'update', 'confirm'].includes(value.strategy as string)) {
    throw new Error('上传来源参数无效')
  }
  const request = value as unknown as UploadSelectionRequest
  pruneUploadSelections()
  if ([...uploadSelections.values()].some(({ selection }) => selection.requestId === request.requestId)) {
    throw new Error('上传请求编号重复')
  }
  const session = filesSession(request.sessionId)
  const sources = await collectUploadSources(request, new AbortController().signal)
  if (!sources) return null
  if (sources.items.length === 0 && sources.failures.length === 0) throw new Error('没有可上传的文件')
  const remoteDirectory = normalizedRemotePath(request.remoteDirectory || '/')
  const remoteRoot = sources.remoteRoot
  const sample = sources.items.find((item) => item.type === 'file')
  const sampleTarget = sample
    ? sample.relativePath ? posix.join(remoteRoot, sample.relativePath) : remoteRoot
    : remoteRoot
  const selection: UploadSelection = {
    selectionId: randomUUID(),
    requestId: request.requestId,
    sessionId: session.sessionId,
    profileId: session.profileId,
    remoteDirectory,
    remoteRoot,
    name: sources.name,
    strategy: request.strategy,
    items: sources.items.map((item) => ({
      name: item.relativePath || basename(sources.remoteRoot),
      type: item.type,
      size: item.size,
    })),
    failures: sources.failures,
    commandPreviews: {
      force: uploadCommandPreview(sampleTarget, 'force'),
      skip: uploadCommandPreview(sampleTarget, 'skip'),
      update: uploadCommandPreview(sampleTarget, 'update'),
    },
  }
  uploadSelections.set(selection.selectionId, {
    selection,
    items: sources.items,
    expiresAt: Date.now() + UPLOAD_SELECTION_TTL_MS,
  })
  return selection
}

export function uploadSelectionContext(selectionId: string): Pick<UploadSelection, 'requestId' | 'sessionId' | 'profileId'> {
  pruneUploadSelections()
  const stored = uploadSelections.get(selectionId)
  if (!stored) throw new Error('上传来源选择已过期，请重新选择')
  return stored.selection
}

export function cancelUploadSelection(selectionId: string): boolean {
  return uploadSelections.delete(selectionId)
}

async function uploadItems(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  sessionId: string,
  profileId: string,
  remoteRoot: string,
  items: TransferItem[],
  sourceFailures: TransferFailure[],
  strategy: OperationExecutionStrategy,
  signal: AbortSignal,
): Promise<TransferResult> {
  signal.throwIfAborted()
  const session = filesSession(sessionId)
  const fileConcurrency = readAppSettings().transferFileConcurrency
  const collisionFailures: TransferFailure[] = []
  const collidingItems = new Set<TransferItem>()
  for (const group of findPathCollisions(items, (item) => item.relativePath)) {
    const message = '本次上传包含重复目标路径'
    for (const item of group) {
      collidingItems.add(item)
      collisionFailures.push({ path: item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot, message })
    }
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
  const directories = items.filter((item) => item.type === 'directory' && !collidingItems.has(item))
    .map((item) => item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot)
  try {
    if (directories.length) {
      await runRemoteCommand(session.client, [
        'set -eu',
        'mkdir -p -- "$@"',
      ].join('\n'), directories, { signal, collectStdout: false })
    }
    const tasks = files.map((item) => {
      const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
      return {
        path: destination,
        size: item.size,
        transfer: async (onProgress: (bytes: number) => void) => {
          signal.throwIfAborted()
          await transferFileStream('upload', session.client, item.localPath!, destination, item.size, signal, onProgress, {
            strategy,
            modifiedAtMs: item.modifiedAtMs!,
          })
        },
      }
    })
    const failures = [
      ...sourceFailures,
      ...collisionFailures,
      ...await runTransferTasks(tasks, fileConcurrency, signal, progress),
    ]
    signal.throwIfAborted()
    return failures.length ? { status: 'completed-with-errors', failures } : { status: 'completed' }
  } finally {
    progress.flush()
  }
}

export async function executeSelectedUpload(
  event: Electron.IpcMainInvokeEvent,
  selectionId: string,
  strategy: OperationExecutionStrategy,
  signal: AbortSignal,
): Promise<TransferResult> {
  if (!['force', 'skip', 'update'].includes(strategy)) throw new Error('上传策略无效')
  const stored = uploadSelections.get(selectionId)
  if (!stored || stored.expiresAt <= Date.now()) {
    uploadSelections.delete(selectionId)
    throw new Error('上传来源选择已过期，请重新选择')
  }
  if (stored.selection.strategy !== 'confirm' && stored.selection.strategy !== strategy) throw new Error('上传策略与所选策略不一致')
  uploadSelections.delete(selectionId)
  return uploadItems(event, stored.selection.requestId, stored.selection.sessionId, stored.selection.profileId,
    stored.selection.remoteRoot, stored.items, stored.selection.failures, strategy, signal)
}
