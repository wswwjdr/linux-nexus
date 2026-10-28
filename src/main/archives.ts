import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import type {
  RemoteArchiveConflict,
  RemoteArchiveDecision,
  RemoteArchiveEvent,
  RemoteArchiveFormat,
  RemoteArchiveProgress,
  RemoteArchiveRequest,
  RemoteArchiveResult,
} from '@shared/types'
import { archiveBaseName, archiveFormatForName } from '@shared/archive'
import { shellQuote } from '@shared/shell'
import {
  executeRemoteCommand,
  fileType,
  normalizedRemotePath,
  remoteAttributesOrNull,
  sftpLstat,
  sftpMkdir,
  sftpReaddir,
  sftpRemoveTree,
  sftpRmdir,
  sftpRename,
  sftpUnlink,
  sftpWriteFile,
  uniqueRemotePath,
} from './sftp-utils'

interface ArchiveExtractionCallbacks {
  onEvent: (event: RemoteArchiveEvent) => void
  askConflict: (conflict: RemoteArchiveConflict, signal: AbortSignal) => Promise<RemoteArchiveDecision>
}

interface ActiveExtraction {
  requestId: string
  controller: AbortController
  completion: Promise<void> | null
}

interface MergeState {
  extractedCount: number
  skippedCount: number
  failedCount: number
  completedCount: number
  cancelled: boolean
  results: RemoteArchiveResult['results']
  filePolicy: 'replace' | 'skip' | 'rename' | null
}

const activeExtractions = new Map<string, ActiveExtraction>()

const PYTHON_EXTRACTION_SCRIPT = String.raw`
import os, re, shutil, stat, subprocess, sys, tarfile, zipfile

archive_format, archive_path, stage, cancel_path = sys.argv[1:]
payload = os.path.join(stage, 'payload')

def check_cancelled():
    if os.path.exists(cancel_path):
        raise RuntimeError('远程解压已取消')

def safe_name(name, is_directory):
    if not name or '\x00' in name:
        raise ValueError('归档包含无效路径：' + repr(name))
    name = name.replace('\\', '/')
    if name.startswith('/') or re.match(r'^[A-Za-z]:', name):
        raise ValueError('归档包含绝对路径：' + repr(name))
    parts = name.split('/')
    if '..' in parts:
        raise ValueError('归档包含路径穿越条目')
    parts = [part for part in parts if part not in ('', '.')]
    if not parts:
        if is_directory:
            return None
        raise ValueError('归档包含无效的文件名')
    return '/'.join(parts)

def validate_records(records):
    names = {}
    total_size = 0
    for name, kind, size, mode in records:
        check_cancelled()
        if name is None:
            continue
        if name in names:
            raise ValueError('归档包含重复路径：' + name)
        parts = name.split('/')
        for index in range(1, len(parts)):
            ancestor = '/'.join(parts[:index])
            if names.get(ancestor) == 'file':
                raise ValueError('归档文件路径互相冲突：' + ancestor + ' 与 ' + name)
        child = next((existing for existing in names if existing.startswith(name + '/')), None) if kind == 'file' else None
        if child:
            raise ValueError('归档文件路径互相冲突：' + name + ' 与 ' + child)
        names[name] = kind
        total_size += size if kind == 'file' else 0
    if total_size > shutil.disk_usage(stage).free:
        raise ValueError('解压所需空间超过目标磁盘可用空间')

def tar_stream(fmt, path):
    if fmt == 'tar-zst':
        if not shutil.which('zstd'):
            raise ValueError('服务器未安装 zstd，无法读取此压缩包')
        process = subprocess.Popen(['zstd', '-dc', '--', path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                for member in archive:
                    yield archive, member
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.wait()
        if process.returncode:
            raise ValueError('zstd 解压失败')
        return
    with tarfile.open(path, mode='r|*') as archive:
        for member in archive:
            yield archive, member

def tar_records(fmt, path):
    records = []
    for archive, member in tar_stream(fmt, path):
        check_cancelled()
        if member.isdir():
            kind = 'directory'
        elif member.isfile():
            kind = 'file'
        else:
            raise ValueError('归档包含符号链接、硬链接或特殊文件：' + member.name)
        name = safe_name(member.name, kind == 'directory')
        if member.size < 0:
            raise ValueError('归档包含无效文件大小：' + member.name)
        records.append((name, kind, member.size, member.mode & 0o777))
    return records

def make_parent(path):
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)

def copy_cancelable(source, target):
    while True:
        check_cancelled()
        chunk = source.read(1024 * 1024)
        if not chunk:
            break
        target.write(chunk)

def zip_is_directory(info, mode):
    return info.is_dir() or info.filename.endswith('\\') or stat.S_IFMT(mode) == stat.S_IFDIR or bool(info.external_attr & 0x10)

def extract_zip(path):
    directories = []
    with zipfile.ZipFile(archive_path) as archive:
        os.mkdir(payload, 0o700)
        for info in archive.infolist():
            check_cancelled()
            mode = (info.external_attr >> 16) & 0o177777
            is_directory = zip_is_directory(info, mode)
            name = safe_name(info.filename, is_directory)
            if name is None:
                continue
            if is_directory and info.file_size:
                raise ValueError('归档目录条目包含文件内容：' + repr(info.filename))
            destination = os.path.join(payload, *name.split('/'))
            if is_directory:
                os.makedirs(destination, mode=0o700, exist_ok=True)
                directories.append((destination, (mode & 0o777) | 0o700))
            else:
                make_parent(destination)
                with archive.open(info, 'r') as source, open(destination, 'xb') as target:
                    copy_cancelable(source, target)
                os.chmod(destination, (mode & 0o777) or 0o644)
    for directory, mode in reversed(directories):
        os.chmod(directory, mode)

records = []
if archive_format == 'zip':
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            check_cancelled()
            mode = (info.external_attr >> 16) & 0o177777
            kind_bits = stat.S_IFMT(mode)
            if info.flag_bits & 1:
                raise ValueError('不支持加密 ZIP 条目：' + info.filename)
            if kind_bits not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise ValueError('归档包含符号链接或特殊文件：' + info.filename)
            is_directory = zip_is_directory(info, mode)
            if is_directory and info.file_size:
                raise ValueError('归档目录条目包含文件内容：' + repr(info.filename))
            name = safe_name(info.filename, is_directory)
            if name is not None:
                records.append((name, 'directory' if is_directory else 'file', info.file_size, mode & 0o777))
    validate_records(records)
    extract_zip(archive_path)
else:
    records = tar_records(archive_format, archive_path)
    validate_records(records)
    os.mkdir(payload, 0o700)
    directories = []
    for archive, member in tar_stream(archive_format, archive_path):
        check_cancelled()
        kind = 'directory' if member.isdir() else 'file'
        name = safe_name(member.name, kind == 'directory')
        if name is None:
            continue
        destination = os.path.join(payload, *name.split('/'))
        if kind == 'directory':
            os.makedirs(destination, mode=0o700, exist_ok=True)
            directories.append((destination, (member.mode & 0o777) | 0o700))
        else:
            make_parent(destination)
            source = archive.extractfile(member)
            if source is None:
                raise ValueError('无法读取归档文件：' + member.name)
            with source, open(destination, 'xb') as target:
                copy_cancelable(source, target)
            os.chmod(destination, (member.mode & 0o777) or 0o644)
    for directory, mode in reversed(directories):
        os.chmod(directory, mode)
`

export function buildArchivePreparationCommand(
  format: RemoteArchiveFormat,
  archivePath: string,
  stagePath: string,
): string {
  const cancelPath = stagePath + '.cancel'
  return [
    'set -eu',
    'umask 077',
    `stage=${shellQuote(stagePath)}`,
    `cancel=${shellQuote(cancelPath)}`,
    'if [ -e "$stage" ] || [ -L "$stage" ]; then printf \'%s\\n\' \'临时解压目录已存在\' >&2; exit 1; fi',
    'mkdir -- "$stage"',
    'cleanup() { rm -rf -- "$stage"; rm -f -- "$cancel"; }',
    'trap cleanup 0',
    "trap 'exit 129' HUP",
    "trap 'exit 130' INT",
    "trap 'exit 143' TERM",
    `python3 -c ${shellQuote(PYTHON_EXTRACTION_SCRIPT)} ${shellQuote(format)} ${shellQuote(archivePath)} "$stage" "$cancel"`,
    'trap - 0 HUP INT TERM',
  ].join('; ')
}

function validateRequest(request: RemoteArchiveRequest): RemoteArchiveRequest {
  if (!request || typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.archivePath !== 'string'
    || typeof request.targetDirectory !== 'string'
    || typeof request.wrapInDirectory !== 'boolean') {
    throw new Error('解压请求参数无效')
  }
  return {
    ...request,
    archivePath: normalizedRemotePath(request.archivePath),
    targetDirectory: normalizedRemotePath(request.targetDirectory),
  }
}

async function validateDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  let currentPath = '/'
  if (fileType((await sftpLstat(sftp, currentPath)).mode) !== 'directory') throw new Error('远程根路径不是文件夹')
  for (const segment of remotePath.split('/').filter(Boolean)) {
    currentPath = posix.join(currentPath, segment)
    if (fileType((await sftpLstat(sftp, currentPath)).mode) !== 'directory') {
      throw new Error('解压目标路径包含非文件夹或符号链接：' + currentPath)
    }
  }
}

function archiveType(mode?: number): RemoteArchiveConflict['targetType'] {
  const kind = fileType(mode)
  return kind === 'file' || kind === 'directory' ? kind : kind
}

async function countTree(sftp: SFTPWrapper, remotePath: string): Promise<number> {
  const type = fileType((await sftpLstat(sftp, remotePath)).mode)
  if (type === 'file') return 1
  if (type !== 'directory') throw new Error('暂存归档包含不支持的文件类型：' + remotePath)
  const entries = await sftpReaddir(sftp, remotePath)
  let count = 1
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    if (entry.filename.includes('/') || entry.filename.includes('\0')) throw new Error('服务器返回了无效的文件名')
    count += await countTree(sftp, posix.join(remotePath, entry.filename))
  }
  return count
}

async function validateDirectoryTree(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const entries = await sftpReaddir(sftp, remotePath)
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') continue
    if (entry.filename.includes('/') || entry.filename.includes('\0')) throw new Error('服务器返回了无效的文件名')
    const childPath = posix.join(remotePath, entry.filename)
    const type = fileType((await sftpLstat(sftp, childPath)).mode)
    if (type === 'symlink' || type === 'other') throw new Error('归档包含符号链接或特殊文件：' + entry.filename)
    if (type === 'directory') await validateDirectoryTree(sftp, childPath)
  }
}

function emptyState(): MergeState {
  return {
    extractedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    completedCount: 0,
    cancelled: false,
    results: [],
    filePolicy: null,
  }
}

function progressEvent(request: RemoteArchiveRequest, phase: RemoteArchiveProgress['phase'], completedCount: number, totalCount: number, currentPath: string | null): RemoteArchiveEvent {
  return {
    type: 'progress',
    progress: { requestId: request.requestId, sessionId: request.sessionId, phase, completedCount, totalCount, currentPath },
  }
}

async function extractArchive(
  client: Client,
  sftp: SFTPWrapper,
  rawRequest: RemoteArchiveRequest,
  callbacks: ArchiveExtractionCallbacks,
  signal: AbortSignal,
): Promise<RemoteArchiveResult> {
  const request = validateRequest(rawRequest)
  const archiveName = posix.basename(request.archivePath)
  const format = archiveFormatForName(archiveName)
  if (!format) throw new Error('不支持的压缩包格式')
  if (request.archivePath === '/') throw new Error('不能解压服务器根目录')
  if (fileType((await sftpLstat(sftp, request.archivePath)).mode) !== 'file') throw new Error('只能解压普通文件')
  await validateDirectory(sftp, request.targetDirectory)

  let outputDirectory = request.wrapInDirectory
    ? posix.join(request.targetDirectory, archiveBaseName(archiveName))
    : request.targetDirectory
  const stagePath = posix.join(request.targetDirectory, '.linux-nexus-extract-' + randomUUID())
  const cancelPath = stagePath + '.cancel'
  const payloadPath = posix.join(stagePath, 'payload')
  const state = emptyState()
  let totalCount = 0
  let preparationError: unknown = null
  let cleanupError: unknown = null

  callbacks.onEvent(progressEvent(request, 'preparing', 0, 0, archiveName))
  try {
    callbacks.onEvent(progressEvent(request, 'extracting', 0, 0, archiveName))
    await executeRemoteCommand(
      client,
      buildArchivePreparationCommand(format, request.archivePath, stagePath),
      signal,
      () => sftpWriteFile(sftp, cancelPath, Buffer.alloc(0)),
    )
    await validateDirectoryTree(sftp, payloadPath)
    totalCount = 0
    for (const entry of await sftpReaddir(sftp, payloadPath)) {
      if (entry.filename === '.' || entry.filename === '..') continue
      totalCount += await countTree(sftp, posix.join(payloadPath, entry.filename))
    }
    callbacks.onEvent(progressEvent(request, 'merging', 0, totalCount, null))
  } catch (error) {
    if (!signal.aborted) preparationError = error
  }

  if (preparationError) {
    try {
      if (await remoteAttributesOrNull(sftp, stagePath)) await sftpRemoveTree(sftp, stagePath)
      if (await remoteAttributesOrNull(sftp, cancelPath)) await sftpUnlink(sftp, cancelPath)
    } catch (error) {
      throw new Error(`${preparationError instanceof Error ? preparationError.message : String(preparationError)}；清理临时目录失败：${error instanceof Error ? error.message : String(error)}`)
    }
    throw preparationError
  }

  const updateProgress = (path: string | null) => callbacks.onEvent(progressEvent(
    request,
    'merging',
    state.completedCount,
    totalCount,
    path,
  ))
  const complete = (count: number, kind: 'extracted' | 'skipped' | 'failed') => {
    state.completedCount += count
    if (kind === 'extracted') state.extractedCount += count
    if (kind === 'skipped') state.skippedCount += count
    if (kind === 'failed') state.failedCount += count
  }
  const makeConflict = (memberPath: string, targetPath: string, sourceType: 'file' | 'directory', targetType: RemoteArchiveConflict['targetType']): RemoteArchiveConflict => ({
    requestId: request.requestId,
    conflictId: randomUUID(),
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    memberPath,
    targetPath,
    sourceType,
    targetType,
    conflictType: sourceType === 'file' && targetType === 'file' ? 'file' : 'type-mismatch',
  })

  const requestDecision = async (conflict: RemoteArchiveConflict): Promise<RemoteArchiveDecision> => {
    if (conflict.conflictType === 'file' && state.filePolicy) return state.filePolicy === 'replace'
      ? 'replace-all'
      : state.filePolicy === 'skip' ? 'skip-all' : 'rename-all'
    callbacks.onEvent({ type: 'conflict', conflict })
    return callbacks.askConflict(conflict, signal)
  }

  const mergeDirectory = async (sourceDirectory: string, targetDirectory: string, prefix: string): Promise<void> => {
    const entries = await sftpReaddir(sftp, sourceDirectory)
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue
      if (signal.aborted || state.cancelled) return
      if (entry.filename.includes('/') || entry.filename.includes('\0')) throw new Error('服务器返回了无效的文件名')
      const sourcePath = posix.join(sourceDirectory, entry.filename)
      const targetPath = posix.join(targetDirectory, entry.filename)
      const memberPath = prefix ? posix.join(prefix, entry.filename) : entry.filename
      const before = state.completedCount
      let subtreeCount = 1
      try {
        subtreeCount = await countTree(sftp, sourcePath)
        const sourceType = fileType((await sftpLstat(sftp, sourcePath)).mode)
        if (sourceType !== 'file' && sourceType !== 'directory') throw new Error('归档包含不支持的文件类型：' + memberPath)
        updateProgress(memberPath)
        const targetAttributes = await remoteAttributesOrNull(sftp, targetPath)
        if (!targetAttributes) {
          await sftpRename(sftp, sourcePath, targetPath)
          complete(subtreeCount, 'extracted')
          updateProgress(memberPath)
          continue
        }

        const targetType = archiveType(targetAttributes.mode)
        if (sourceType === 'directory' && targetType === 'directory') {
          complete(1, 'extracted')
          await mergeDirectory(sourcePath, targetPath, memberPath)
          await sftpRmdir(sftp, sourcePath)
          updateProgress(memberPath)
          continue
        }

        const conflict = makeConflict(memberPath, targetPath, sourceType, targetType)
        const decision = await requestDecision(conflict)
        if (decision === 'cancel' || signal.aborted) {
          state.cancelled = true
          return
        }
        if (conflict.conflictType === 'file') {
          if (decision === 'replace-all') state.filePolicy = 'replace'
          if (decision === 'skip-all') state.filePolicy = 'skip'
          if (decision === 'rename-all') state.filePolicy = 'rename'
        } else if (decision === 'replace-all' || decision === 'skip-all' || decision === 'rename-all') {
          throw new Error('压缩包类型冲突决策无效')
        }

        if (decision === 'skip' || decision === 'skip-all') {
          complete(subtreeCount, 'skipped')
          state.results.push({ path: memberPath, status: 'skipped' })
        } else if (decision === 'rename' || decision === 'rename-all') {
          const renamedPath = await uniqueRemotePath(sftp, targetPath, sourceType)
          await sftpRename(sftp, sourcePath, renamedPath)
          complete(subtreeCount, 'extracted')
        } else if (decision === 'replace' || decision === 'replace-all') {
          await sftpRemoveTree(sftp, targetPath, signal)
          if (signal.aborted) {
            state.cancelled = true
            complete(subtreeCount, 'failed')
            state.results.push({ path: memberPath, status: 'failed', message: '目标已删除，但取消前未能写入归档内容' })
            updateProgress(memberPath)
            return
          }
          await sftpRename(sftp, sourcePath, targetPath)
          complete(subtreeCount, 'extracted')
        } else {
          throw new Error('压缩包冲突决策无效')
        }
        updateProgress(memberPath)
      } catch (error) {
        const alreadyCompleted = state.completedCount - before
        const remaining = Math.max(0, subtreeCount - alreadyCompleted)
        if (remaining > 0) complete(remaining, 'failed')
        state.results.push({ path: memberPath, status: 'failed', message: error instanceof Error ? error.message : String(error) })
        updateProgress(memberPath)
      }
    }
  }

  try {
    if (signal.aborted) state.cancelled = true
    if (!state.cancelled && request.wrapInDirectory) {
      const targetAttributes = await remoteAttributesOrNull(sftp, outputDirectory)
      if (!targetAttributes) {
        await sftpMkdir(sftp, outputDirectory)
      } else if (fileType(targetAttributes.mode) !== 'directory') {
        const conflict = makeConflict(archiveBaseName(archiveName) + '/', outputDirectory, 'directory', archiveType(targetAttributes.mode))
        const decision = await requestDecision(conflict)
        if (decision === 'cancel' || signal.aborted) state.cancelled = true
        else if (decision === 'skip') {
          complete(totalCount, 'skipped')
          state.results.push({ path: archiveBaseName(archiveName) + '/', status: 'skipped' })
        } else if (decision === 'replace') {
          await sftpRemoveTree(sftp, outputDirectory, signal)
          if (signal.aborted) {
            state.cancelled = true
            if (totalCount > 0) complete(totalCount, 'failed')
            state.results.push({ path: outputDirectory, status: 'failed', message: '目标已删除，但取消前未能写入归档内容' })
          } else {
            await sftpMkdir(sftp, outputDirectory)
          }
        } else if (decision === 'rename') {
          outputDirectory = await uniqueRemotePath(sftp, outputDirectory, 'directory')
          await sftpMkdir(sftp, outputDirectory)
        } else {
          throw new Error('解压目录类型冲突决策无效')
        }
      }
    }
    if (!state.cancelled && !signal.aborted && state.completedCount < totalCount) {
      try {
        await mergeDirectory(payloadPath, outputDirectory, '')
      } catch (error) {
        const remaining = Math.max(0, totalCount - state.completedCount)
        if (remaining > 0) complete(remaining, 'failed')
        state.results.push({ path: outputDirectory, status: 'failed', message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (signal.aborted) state.cancelled = true
  } finally {
    try {
      if (await remoteAttributesOrNull(sftp, stagePath)) await sftpRemoveTree(sftp, stagePath)
    } catch (error) {
      cleanupError = error
    }
    try {
      if (await remoteAttributesOrNull(sftp, cancelPath)) await sftpUnlink(sftp, cancelPath)
    } catch (error) {
      cleanupError ??= error
    }
  }

  if (cleanupError) {
    state.failedCount += 1
    state.results.push({ path: stagePath, status: 'failed', message: '清理临时目录失败：' + (cleanupError instanceof Error ? cleanupError.message : String(cleanupError)) })
  }
  const cancelledCount = Math.max(0, totalCount - state.completedCount)
  return {
    status: state.cancelled || signal.aborted ? 'cancelled' : 'completed',
    outputDirectory,
    extractedCount: state.extractedCount,
    skippedCount: state.skippedCount,
    failedCount: state.failedCount,
    cancelledCount,
    results: state.results,
  }
}

export function startRemoteArchiveExtraction(
  client: Client,
  sftp: SFTPWrapper,
  request: RemoteArchiveRequest,
  callbacks: ArchiveExtractionCallbacks,
): Promise<RemoteArchiveResult> {
  const normalizedRequest = validateRequest(request)
  if (activeExtractions.has(normalizedRequest.sessionId)) throw new Error('此 SFTP 会话已有解压任务正在进行')
  const controller = new AbortController()
  const active: ActiveExtraction = { requestId: normalizedRequest.requestId, controller, completion: null }
  activeExtractions.set(normalizedRequest.sessionId, active)
  const run = extractArchive(client, sftp, normalizedRequest, callbacks, controller.signal)
  active.completion = run.then(() => {}, () => {})
  return run
    .finally(() => {
      if (activeExtractions.get(normalizedRequest.sessionId) === active) activeExtractions.delete(normalizedRequest.sessionId)
    })
}

export function cancelRemoteArchiveExtraction(requestId: string): boolean {
  const active = [...activeExtractions.values()].find((item) => item.requestId === requestId)
  if (!active || active.controller.signal.aborted) return false
  active.controller.abort()
  return true
}

export function cancelRemoteArchiveExtractionsForSession(sessionId: string): Promise<void> {
  const active = activeExtractions.get(sessionId)
  if (!active) return Promise.resolve()
  active.controller.abort()
  return active.completion ?? Promise.resolve()
}
