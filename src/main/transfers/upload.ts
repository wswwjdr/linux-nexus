import { dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { lstat as localLstat } from 'node:fs/promises'
import { basename, isAbsolute, posix } from 'node:path'
import type { OperationConflict, OperationExecutionStrategy, TransferFailure, TransferResult, UploadPreflight, UploadPreflightRequest } from '@shared/types'
import type { TransferItem } from '../runtime'
import { getMainWindow, messageFromError } from '../runtime'
import { readAppSettings } from '../state-store'
import { filesSession, normalizedRemotePath, remotePathType } from '../remote-fs'
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

interface StoredUploadPreflight {
  publicPreflight: UploadPreflight
  items: TransferItem[]
  expiresAt: number
}

interface UploadSources {
  remoteRoot: string
  name: string
  items: TransferItem[]
  failures: TransferFailure[]
}

const uploadPreflights = new Map<string, StoredUploadPreflight>()
const UPLOAD_PREFLIGHT_TTL_MS = 10 * 60_000

function pruneUploadPreflights(): void {
  const now = Date.now()
  for (const [id, preflight] of uploadPreflights) {
    if (preflight.expiresAt <= now) uploadPreflights.delete(id)
  }
}

async function collectUploadSources(request: UploadPreflightRequest, signal: AbortSignal): Promise<UploadSources | null> {
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

const uploadConflictScript = [
  'for path in "$@"; do',
  '  if [[ -e "$path" || -L "$path" ]]; then',
  '    if [[ -L "$path" ]]; then type=symlink; elif [[ -d "$path" ]]; then type=directory; elif [[ -f "$path" ]]; then type=file; else type=other; fi',
  '    printf "%s\\0%s\\0" "$path" "$type"',
  '  fi',
  'done',
].join('\n')

function parseUploadConflicts(output: Buffer, items: TransferItem[], remoteRoot: string): OperationConflict[] {
  const fields = output.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2 !== 0) throw new Error('服务器返回的上传冲突清单格式无效')
  const itemsByPath = new Map(items.map((item) => [item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot, item]))
  const conflicts: OperationConflict[] = []
  for (let index = 0; index < fields.length; index += 2) {
    const targetPath = fields[index]
    const targetType = fields[index + 1]
    const item = itemsByPath.get(targetPath)
    if (!item || (targetType !== 'file' && targetType !== 'directory' && targetType !== 'symlink' && targetType !== 'other')) {
      throw new Error('服务器返回了无效的上传冲突')
    }
    conflicts.push({
      sourcePath: item.localPath ?? item.relativePath,
      targetPath,
      sourceType: item.type,
      targetType,
    })
  }
  const unsupported = conflicts.find((conflict) => conflict.targetType === 'symlink' || conflict.targetType === 'other')
  if (unsupported) throw new Error('上传目标包含符号链接或特殊文件：' + unsupported.targetPath)
  return conflicts
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

export async function preflightUpload(value: unknown): Promise<UploadPreflight | null> {
  if (!isRecord(value)
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || typeof value.remoteDirectory !== 'string'
    || !['files', 'folder', 'drop'].includes(value.mode as string)
    || !['force', 'skip', 'update', 'confirm'].includes(value.strategy as string)) {
    throw new Error('上传预检参数无效')
  }
  const request = value as unknown as UploadPreflightRequest
  pruneUploadPreflights()
  if ([...uploadPreflights.values()].some(({ publicPreflight }) => publicPreflight.requestId === request.requestId)) {
    throw new Error('上传请求编号重复')
  }
  const session = filesSession(request.sessionId)
  const sources = await collectUploadSources(request, new AbortController().signal)
  if (!sources) return null
  if (sources.items.length === 0 && sources.failures.length === 0) throw new Error('没有可上传的文件')
  const remoteDirectory = normalizedRemotePath(request.remoteDirectory || '/')
  if (await remotePathType(session.client, remoteDirectory) !== 'directory') throw new Error('上传目标不是文件夹')

  const remoteRoot = sources.remoteRoot
  const destinations = sources.items.map((item) => item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot)
  const { stdout } = destinations.length
    ? await runRemoteCommand(session.client, uploadConflictScript, destinations)
    : { stdout: Buffer.alloc(0) }
  const conflicts = parseUploadConflicts(stdout, sources.items, remoteRoot)
  const typeMismatch = conflicts.find((conflict) => conflict.sourceType !== conflict.targetType)
  if (typeMismatch) throw new Error('上传来源与目标类型不一致：' + typeMismatch.targetPath)
  const sample = sources.items.find((item) => item.type === 'file')
  const sampleTarget = sample
    ? sample.relativePath ? posix.join(remoteRoot, sample.relativePath) : remoteRoot
    : remoteRoot
  const preflight: UploadPreflight = {
    preflightId: randomUUID(),
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
    conflicts,
    failures: sources.failures,
    commandPreviews: {
      force: uploadCommandPreview(sampleTarget, 'force'),
      skip: uploadCommandPreview(sampleTarget, 'skip'),
      update: uploadCommandPreview(sampleTarget, 'update'),
    },
  }
  uploadPreflights.set(preflight.preflightId, {
    publicPreflight: preflight,
    items: sources.items,
    expiresAt: Date.now() + UPLOAD_PREFLIGHT_TTL_MS,
  })
  return preflight
}

export function uploadPreflightContext(preflightId: string): Pick<UploadPreflight, 'requestId' | 'sessionId' | 'profileId'> {
  pruneUploadPreflights()
  const stored = uploadPreflights.get(preflightId)
  if (!stored) throw new Error('上传预检已过期，请重新操作')
  return stored.publicPreflight
}

export function cancelUploadPreflight(preflightId: string): boolean {
  return uploadPreflights.delete(preflightId)
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
        'missing=()',
        'for directory in "$@"; do',
        '  if [[ -e "$directory" || -L "$directory" ]]; then [[ -d "$directory" && ! -L "$directory" ]] || { printf "上传目录目标类型不匹配: %s\\n" "$directory" >&2; exit 1; }',
        '  else missing+=("$directory"); fi',
        'done',
        'if ((${#missing[@]})); then mkdir -p -- "${missing[@]}"; fi',
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

export async function executePreparedUpload(
  event: Electron.IpcMainInvokeEvent,
  preflightId: string,
  strategy: OperationExecutionStrategy,
  signal: AbortSignal,
): Promise<TransferResult> {
  if (!['force', 'skip', 'update'].includes(strategy)) throw new Error('上传策略无效')
  const stored = uploadPreflights.get(preflightId)
  if (!stored || stored.expiresAt <= Date.now()) {
    uploadPreflights.delete(preflightId)
    throw new Error('上传预检已过期，请重新操作')
  }
  const preflight = stored.publicPreflight
  if (preflight.strategy !== 'confirm' && preflight.strategy !== strategy) throw new Error('上传策略与预检策略不一致')
  uploadPreflights.delete(preflightId)
  const skipped = strategy === 'skip'
    ? preflight.conflicts.map((conflict) => conflict.targetPath)
    : []
  const skippedDirectories = preflight.conflicts
    .filter((conflict) => conflict.sourceType === 'directory' && conflict.targetType !== 'directory')
    .map((conflict) => conflict.targetPath)
  const items = stored.items.filter((item) => {
    const target = item.relativePath ? posix.join(preflight.remoteRoot, item.relativePath) : preflight.remoteRoot
    return !skipped.includes(target)
      && !skippedDirectories.some((directory) => target === directory || target.startsWith(directory + '/'))
  })
  return uploadItems(event, preflight.requestId, preflight.sessionId, preflight.profileId,
    preflight.remoteRoot, items, preflight.failures, strategy, signal)
}
