import { type MessageValue, messageFromUnknown, msg, LocalizedError } from '../shared/i18n/messages'
import { posix } from 'node:path'
import { executeRemoteCommand, RemoteCommandError, RemoteTerminationError } from './ssh-commands'
import { fileCommands } from './file-identity'
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
  controller: AbortController
  pending: Buffer
  results: NameSearchResult[]
  matchedFiles: number
  startedAt: number
  lastProgressAt: number
  incomplete: boolean
  hasReadErrors: boolean
  finished: boolean
  cancelled: boolean
  progressTimer: ReturnType<typeof setTimeout> | null
  flushTimer: ReturnType<typeof setTimeout> | null

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
    throw new LocalizedError(msg('errors.invalidFilenameSearchCriteria'))
  }
  const rootPath = normalizedRemotePath(value.rootPath)
  if (!value.rootPath.startsWith('/') || rootPath !== value.rootPath) {
    throw new LocalizedError(msg('errors.searchScopeMustBeANormalizedAbsoluteRemotePath'))
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

function finishSearch(task: NameSearchTask, status: SearchRunStatus, message?: MessageValue): void {
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
  if (activeSearches.has(request.requestId)) throw new LocalizedError(msg('errors.filenameSearchRequestIdIsAlreadyInUse'))
  const session = sessions.get(request.sessionId)
  if (!session || session.kind !== 'files' || session.profileId !== request.profileId) throw new LocalizedError(msg('errors.fileSessionIsNotConnected'))
  const commands = fileCommands(session)

  const task: NameSearchTask = {
    request,
    controller: new AbortController(),
    pending: Buffer.alloc(0),
    results: [],
    matchedFiles: 0,
    startedAt: Date.now(),
    lastProgressAt: 0,
    incomplete: false,
    hasReadErrors: false,
    finished: false,
    cancelled: false,
    progressTimer: null,
    flushTimer: null,
  }
  activeSearches.set(request.requestId, task)
  emitProgress(task, true)

  void executeRemoteCommand(commands, buildNameSearchCommand(request), {
    signal: task.controller.signal, collectStdout: false, keepStdinOpen: true, timeoutMs: 86_400_000,
    maxStdoutBytes: 32 * 1024 * 1024,
    onStdout: (chunk) => {
      task.pending = Buffer.concat([task.pending, chunk])
      if (task.pending.length > 1024 * 1024) throw new LocalizedError(msg('errors.searchRecordExceedsTheSizeLimit'))
      let delimiter = task.pending.indexOf(0)
      while (delimiter >= 0) {
        if (!delimiter) throw new LocalizedError(msg('errors.remoteFilenameSearchReturnedAnEmptyPath'))
        queueResult(task, task.pending.subarray(0, delimiter).toString('utf8'))
        task.pending = task.pending.subarray(delimiter + 1)
        delimiter = task.pending.indexOf(0)
      }
    },
    onStderr: () => markReadError(task),
    onComplete: (error) => {
      if (task.finished) return
      if (error instanceof RemoteTerminationError && task.cancelled) finishSearch(task, 'cancelled', messageFromUnknown(error))
      else if (task.pending.length) finishSearch(task, 'failed', msg('errors.invalidRemoteFilenameSearchResult'))
      else if (!error || (error instanceof RemoteCommandError && error.exitCode === 1 && task.hasReadErrors)) finishSearch(task, 'completed')
      else { task.incomplete = true; finishSearch(task, 'failed', messageFromUnknown(error)) }
    },
  }).catch(() => undefined)

}

export function cancelNameSearch(requestId: string): boolean {
  const task = activeSearches.get(requestId)
  if (!task) return false
  task.cancelled = true
  task.controller.abort()
  return true
}

export function cancelNameSearchesForSession(sessionId: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) cancelNameSearch(task.request.requestId)
  }
}

export function failNameSearchesForSession(sessionId: string, message: MessageValue): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) { finishSearch(task, 'failed', message); task.controller.abort() }
  }
}
