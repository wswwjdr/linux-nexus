import { posix } from 'node:path'
import type { ClientChannel } from 'ssh2'
import type {
  NameSearchEvent,
  NameSearchProgress,
  NameSearchRequest,
  NameSearchResult,
  SearchRunStatus,
} from '@shared/types'
import { shellQuote } from '@shared/shell'
import { getMainWindow, sessions } from './runtime'
import { normalizedRemotePath } from './remote-fs'

interface NameSearchTask {
  request: NameSearchRequest
  stream: ClientChannel | null
  pending: Buffer
  results: NameSearchResult[]
  matchedFiles: number
  startedAt: number
  lastProgressAt: number
  incomplete: boolean
  hasReadErrors: boolean
  finished: boolean
  cancelled: boolean
  exitCode: number | null
  progressTimer: ReturnType<typeof setTimeout> | null
  flushTimer: ReturnType<typeof setTimeout> | null
  listeners: {
    data?: (chunk: Buffer) => void
    stderr?: (chunk: Buffer) => void
    error?: (error: Error) => void
    exit?: (code: number | null) => void
    close?: () => void
  }
}

const activeSearches = new Map<string, NameSearchTask>()
const RESULT_BATCH_SIZE = 100
const MAX_QUERY_LENGTH = 4096
const MAX_PATH_LENGTH = 4096

function validateRequest(value: NameSearchRequest): NameSearchRequest {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId || value.requestId.length > 128
    || value.requestId.includes('\0') || value.requestId.includes('\n') || value.requestId.includes('\r')
    || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 128
    || value.sessionId.includes('\0') || value.sessionId.includes('\n') || value.sessionId.includes('\r')
    || typeof value.profileId !== 'string' || !value.profileId || value.profileId.length > 128
    || value.profileId.includes('\0') || value.profileId.includes('\n') || value.profileId.includes('\r')
    || typeof value.rootPath !== 'string' || value.rootPath.length > MAX_PATH_LENGTH
    || value.rootPath.includes('\0') || value.rootPath.includes('\n') || value.rootPath.includes('\r')
    || typeof value.query !== 'string' || !value.query || value.query.length > MAX_QUERY_LENGTH
    || value.query.includes('\0') || value.query.includes('\n') || value.query.includes('\r')
    || (value.matchMode !== 'exact' && value.matchMode !== 'contains')
    || typeof value.ignoreCase !== 'boolean') {
    throw new Error('文件名搜索条件无效')
  }
  const rootPath = normalizedRemotePath(value.rootPath)
  if (!value.rootPath.startsWith('/') || rootPath !== value.rootPath) {
    throw new Error('搜索范围必须是规范化的绝对远端路径')
  }
  return value
}

function progress(task: NameSearchTask): NameSearchProgress {
  return {
    requestId: task.request.requestId,
    sessionId: task.request.sessionId,
    profileId: task.request.profileId,
    elapsedMs: Date.now() - task.startedAt,
    matchedFiles: task.matchedFiles,
    incomplete: task.incomplete,
    hasReadErrors: task.hasReadErrors,
  }
}

function sendEvent(event: NameSearchEvent): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('files:name-search-event', event)
}

function emitProgress(task: NameSearchTask, force = false): void {
  const now = Date.now()
  if (!force && now - task.lastProgressAt < 300) {
    if (!task.progressTimer) {
      task.progressTimer = setTimeout(() => {
        task.progressTimer = null
        emitProgress(task, true)
      }, 300 - (now - task.lastProgressAt))
    }
    return
  }
  if (task.progressTimer) {
    clearTimeout(task.progressTimer)
    task.progressTimer = null
  }
  task.lastProgressAt = now
  sendEvent({ type: 'progress', ...progress(task) })
}

function flushResults(task: NameSearchTask): void {
  if (task.flushTimer) {
    clearTimeout(task.flushTimer)
    task.flushTimer = null
  }
  if (!task.results.length) return
  const results = task.results
  task.results = []
  sendEvent({ type: 'results', results, ...progress(task) })
}

function queueResult(task: NameSearchTask, path: string): void {
  task.matchedFiles += 1
  task.results.push({ name: posix.basename(path), path, type: 'file' })
  if (task.results.length >= RESULT_BATCH_SIZE) flushResults(task)
  else if (!task.flushTimer) task.flushTimer = setTimeout(() => flushResults(task), 150)
  emitProgress(task)
}

function finishSearch(task: NameSearchTask, status: SearchRunStatus, message?: string): void {
  if (task.finished) return
  task.finished = true
  if (task.progressTimer) clearTimeout(task.progressTimer)
  if (task.flushTimer) clearTimeout(task.flushTimer)
  task.progressTimer = null
  task.flushTimer = null
  flushResults(task)
  emitProgress(task, true)
  sendEvent({ type: 'finished', status, ...(message ? { message } : {}), ...progress(task) })
  activeSearches.delete(task.request.requestId)
  const stream = task.stream
  if (!stream) return
  if (task.listeners.data) stream.removeListener('data', task.listeners.data)
  if (task.listeners.stderr) stream.stderr.removeListener('data', task.listeners.stderr)
  if (task.listeners.error) stream.removeListener('error', task.listeners.error)
  if (task.listeners.exit) stream.removeListener('exit', task.listeners.exit)
  if (task.listeners.close) stream.removeListener('close', task.listeners.close)
}

function markReadError(task: NameSearchTask): void {
  task.incomplete = true
  task.hasReadErrors = true
  emitProgress(task)
}

function escapeFindPattern(value: string): string {
  return value.replace(/[\\*?\[\]]/g, '\\$&')
}

export function buildNameSearchCommand(request: NameSearchRequest): string {
  const literal = escapeFindPattern(request.query)
  const pattern = request.matchMode === 'contains' ? `*${literal}*` : literal
  const matcher = request.ignoreCase ? '-iname' : '-name'
  return [
    'find --',
    shellQuote(request.rootPath),
    '-type f',
    matcher,
    shellQuote(pattern),
    '-print0',
  ].join(' ')
}

export function startNameSearch(input: NameSearchRequest): void {
  const request = validateRequest(input)
  if (activeSearches.has(request.requestId)) throw new Error('文件名搜索请求编号已在使用')
  const session = sessions.get(request.sessionId)
  if (!session || session.kind !== 'files' || session.profileId !== request.profileId) throw new Error('文件会话未连接')

  const task: NameSearchTask = {
    request,
    stream: null,
    pending: Buffer.alloc(0),
    results: [],
    matchedFiles: 0,
    startedAt: Date.now(),
    lastProgressAt: 0,
    incomplete: false,
    hasReadErrors: false,
    finished: false,
    cancelled: false,
    exitCode: null,
    progressTimer: null,
    flushTimer: null,
    listeners: {},
  }
  activeSearches.set(request.requestId, task)
  emitProgress(task, true)

  try {
    session.client.exec(buildNameSearchCommand(request), (error, stream) => {
      if (error) {
        finishSearch(task, task.cancelled ? 'cancelled' : 'failed', error.message || '无法启动文件名搜索')
        return
      }
      task.stream = stream
      if (task.finished) {
        stream.close()
        return
      }
      task.listeners.data = (chunk) => {
        task.pending = task.pending.length ? Buffer.concat([task.pending, Buffer.from(chunk)]) : Buffer.from(chunk)
        let delimiter = task.pending.indexOf(0)
        while (delimiter >= 0) {
          if (delimiter === 0) {
            stream.close()
            finishSearch(task, 'failed', '远端文件名搜索返回了空路径')
            return
          }
          queueResult(task, task.pending.subarray(0, delimiter).toString('utf8'))
          task.pending = task.pending.subarray(delimiter + 1)
          delimiter = task.pending.indexOf(0)
        }
      }
      task.listeners.stderr = (chunk) => {
        if (Buffer.from(chunk).length) markReadError(task)
      }
      task.listeners.error = (streamError) => {
        if (task.cancelled) finishSearch(task, 'cancelled')
        else finishSearch(task, 'failed', '文件名搜索连接失败：' + streamError.message)
      }
      task.listeners.exit = (code) => {
        task.exitCode = typeof code === 'number' ? code : null
      }
      task.listeners.close = () => {
        if (task.finished) return
        if (task.cancelled) {
          finishSearch(task, 'cancelled')
          return
        }
        if (task.pending.length) {
          finishSearch(task, 'failed', '远端文件名搜索结果格式无效')
          return
        }
        if (task.exitCode === 0 || (task.exitCode === 1 && task.hasReadErrors)) finishSearch(task, 'completed')
        else if (task.exitCode === null) finishSearch(task, 'failed', 'SSH 连接中断，文件名搜索已停止')
        else finishSearch(task, 'failed', '远端文件名搜索未能完整结束（退出码 ' + task.exitCode + '）')
      }
      stream.on('data', task.listeners.data)
      stream.stderr.on('data', task.listeners.stderr)
      stream.once('error', task.listeners.error)
      stream.once('exit', task.listeners.exit)
      stream.once('close', task.listeners.close)
    })
  } catch (error) {
    finishSearch(task, 'failed', error instanceof Error ? error.message : String(error))
  }
}

export function cancelNameSearch(requestId: string): boolean {
  const task = activeSearches.get(requestId)
  if (!task) return false
  task.cancelled = true
  task.stream?.close()
  finishSearch(task, 'cancelled')
  return true
}

export function cancelNameSearchesForSession(sessionId: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) cancelNameSearch(task.request.requestId)
  }
}

export function failNameSearchesForSession(sessionId: string, message: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) finishSearch(task, 'failed', message)
  }
}
