import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type {
  RemoteSearchEvent,
  RemoteSearchLineMatch,
  RemoteSearchRequest,
  RemoteSearchResult,
} from '@shared/types'
import { remoteRegexError } from '@shared/search-utils'
import { getMainWindow, sessions } from './runtime'
import { normalizedRemotePath, shellQuote } from './sftp-utils'

interface SearchTask {
  request: RemoteSearchRequest
  stream: ClientChannel | null
  finished: boolean
  cancelled: boolean
  remoteDone: boolean
  exitCode: number | null
  scannedEntries: number
  matchedFiles: number
  matchedLines: number
  skippedEntries: number
  incomplete: boolean
  lastProgressAt: number
  results: RemoteSearchResult[]
  bufferedResultBytes: number
  fields: string[]
  pending: Buffer
  flushTimer: ReturnType<typeof setTimeout> | null
  currentEntry: RemoteSearchResult | null
  contextLines: Map<number, { text: string; matched: boolean }>
  decoder: StringDecoder
  stderrRemainder: string
  listeners: {
    data?: (chunk: Buffer) => void
    stderr?: (chunk: Buffer) => void
    error?: (error: Error) => void
    exit?: (code: number | null) => void
    close?: () => void
  }
}

const activeSearches = new Map<string, SearchTask>()
const RESULT_BATCH_SIZE = 25
const MAX_QUERY_LENGTH = 4096
const MAX_FILE_SIZE_MIB = 102400

function validateRequest(value: RemoteSearchRequest): RemoteSearchRequest {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || typeof value.profileId !== 'string' || !value.profileId
    || typeof value.query !== 'string' || !value.query || value.query.length > MAX_QUERY_LENGTH
    || value.query.includes('\0') || value.query.includes('\n') || value.query.includes('\r')
    || (value.mode !== 'name' && value.mode !== 'content')
    || (value.matcher !== 'literal' && value.matcher !== 'regex')
    || (value.scope !== 'current' && value.scope !== 'root')
    || typeof value.rootPath !== 'string' || value.rootPath.includes('\0')
    || typeof value.maxFileSizeMiB !== 'number' || !Number.isInteger(value.maxFileSizeMiB)
    || (value.mode === 'content' && (value.maxFileSizeMiB < 1 || value.maxFileSizeMiB > MAX_FILE_SIZE_MIB))
    || typeof value.includeSystemPaths !== 'boolean'
    || typeof value.includeMountedFilesystems !== 'boolean') {
    throw new Error('搜索条件无效，请检查查询内容和高级选项')
  }

  const rootPath = normalizedRemotePath(value.rootPath)
  if (rootPath !== value.rootPath || (value.scope === 'root' && rootPath !== '/')) {
    throw new Error('搜索范围无效，请重新选择范围')
  }
  if (value.matcher === 'regex') {
    const regexError = remoteRegexError(value.query)
    if (regexError) throw new Error(regexError)
  }
  return value
}

function progress(task: SearchTask) {
  return {
    requestId: task.request.requestId,
    sessionId: task.request.sessionId,
    profileId: task.request.profileId,
    scannedEntries: task.scannedEntries,
    matchedFiles: task.matchedFiles,
    matchedLines: task.matchedLines,
    skippedEntries: task.skippedEntries,
    incomplete: task.incomplete,
  }
}

function sendEvent(event: RemoteSearchEvent): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('files:search-event', event)
}

function emitProgress(task: SearchTask, force = false): void {
  const now = Date.now()
  if (!force && now - task.lastProgressAt < 300 && task.scannedEntries % 50 !== 0) return
  task.lastProgressAt = now
  sendEvent({ type: 'progress', ...progress(task) })
}

function flushResults(task: SearchTask): void {
  if (task.flushTimer) {
    clearTimeout(task.flushTimer)
    task.flushTimer = null
  }
  if (!task.results.length) return
  const results = task.results
  task.results = []
  task.bufferedResultBytes = 0
  sendEvent({ type: 'results', results, ...progress(task) })
}

function queueResult(task: SearchTask, result: RemoteSearchResult, matchedLines = 0): void {
  task.matchedFiles += 1
  task.matchedLines += matchedLines
  task.results.push(result)
  task.bufferedResultBytes += (result.name.length + result.path.length
    + result.matches.reduce((total, match) => total + match.text.length
      + (match.before?.text.length ?? 0) + (match.after?.text.length ?? 0), 0)) * 2
  if (task.results.length >= RESULT_BATCH_SIZE || task.bufferedResultBytes >= 1024 * 1024) {
    flushResults(task)
  } else if (!task.flushTimer) {
    task.flushTimer = setTimeout(() => flushResults(task), 300)
  }
}

function finishSearch(task: SearchTask, status: 'completed' | 'cancelled' | 'failed', message?: string): void {
  if (task.finished) return
  task.finished = true
  flushResults(task)
  emitProgress(task, true)
  sendEvent({ type: 'finished', status, ...(message ? { message } : {}), ...progress(task) })
  activeSearches.delete(task.request.requestId)
  const stream = task.stream
  if (stream) {
    if (task.listeners.data) stream.removeListener('data', task.listeners.data)
    if (task.listeners.error) stream.removeListener('error', task.listeners.error)
    if (task.listeners.exit) stream.removeListener('exit', task.listeners.exit)
    if (task.listeners.close) stream.removeListener('close', task.listeners.close)
    if (task.listeners.stderr) stream.stderr.removeListener('data', task.listeners.stderr)
  }
}

function markSkipped(task: SearchTask, incomplete = false): void {
  task.skippedEntries += 1
  task.incomplete ||= incomplete
}

function addStderr(task: SearchTask, chunk: Buffer, flush = false): void {
  task.stderrRemainder += task.decoder.write(chunk)
  const lines = task.stderrRemainder.split(/\r?\n/)
  task.stderrRemainder = lines.pop() ?? ''
  if (flush) {
    task.stderrRemainder += task.decoder.end()
    if (task.stderrRemainder.trim()) lines.push(task.stderrRemainder)
    task.stderrRemainder = ''
  }
  for (const line of lines) {
    if (line.trim()) markSkipped(task, true)
  }
}

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8')
}

function matchesName(task: SearchTask, name: string, expression: RegExp | null): boolean {
  if (expression) return expression.test(name)
  return name.toLocaleLowerCase().includes(task.request.query.toLocaleLowerCase())
}

function completeContentResult(task: SearchTask): void {
  if (!task.currentEntry || !task.contextLines) return
  const hits = [...task.contextLines.entries()]
    .filter(([, line]) => line.matched)
    .sort(([left], [right]) => left - right)
  if (hits.length) {
    const matches: RemoteSearchLineMatch[] = hits.map(([lineNumber]) => {
      const before = task.contextLines.get(lineNumber - 1)
      const after = task.contextLines.get(lineNumber + 1)
      return {
        lineNumber,
        ...(before ? { before: { lineNumber: lineNumber - 1, text: before.text } } : {}),
        text: task.contextLines.get(lineNumber)!.text,
        ...(after ? { after: { lineNumber: lineNumber + 1, text: after.text } } : {}),
      }
    })
    queueResult(task, { ...task.currentEntry, matches }, matches.length)
  }
  task.currentEntry = null
  task.contextLines = new Map()
}

function processField(task: SearchTask, field: string, expression: RegExp | null): void {
  task.fields.push(field)
  const marker = task.fields[0]
  const fieldCount = marker === 'E' ? 4
    : marker === 'M' ? 3
      : marker === 'L' || marker === 'D' || marker === 'F' ? 2
      : marker === 'P' || marker === 'S' || marker === 'I' || marker === 'X' ? 1
        : 0
  if (!fieldCount) {
    task.fields = []
    throw new Error('远端搜索响应格式无效')
  }
  if (task.fields.length < fieldCount) return
  const fields = task.fields
  task.fields = []

  if (marker === 'S') {
    markSkipped(task)
    emitProgress(task)
    return
  }
  if (marker === 'I') {
    markSkipped(task, true)
    emitProgress(task)
    return
  }
  if (marker === 'P') {
    task.scannedEntries += 1
    markSkipped(task)
    emitProgress(task)
    return
  }
  if (marker === 'E') {
    const [, kind, sizeText, pathBase64] = fields
    const path = decodeBase64(pathBase64)
    const size = Number(sizeText)
    const type = kind === 'd' ? 'directory' : kind === 'f' ? 'file' : kind === 'l' ? 'symlink' : 'other'
    task.scannedEntries += 1
    const entry: RemoteSearchResult = {
      name: posix.basename(path) || '/',
      path,
      type,
      size: Number.isFinite(size) ? size : 0,
      matches: [],
    }

    if (task.request.mode === 'name' && path !== task.request.rootPath && matchesName(task, entry.name, expression)) {
      queueResult(task, entry)
    }
    task.currentEntry = entry
    emitProgress(task)
    return
  }
  if (marker === 'M') {
    task.currentEntry = {
      name: posix.basename(decodeBase64(fields[1])) || '/',
      path: decodeBase64(fields[1]),
      type: 'file',
      size: Number(fields[2]),
      matches: [],
    }
    task.contextLines = new Map()
    return
  }
  if (marker === 'L') {
    const line = decodeBase64(fields[1])
    if (line === '--' || !task.contextLines) return
    const match = /^(\d+)([:\-])(.*)$/.exec(line)
    if (!match) throw new Error('远端搜索行响应格式无效')
    task.contextLines.set(Number(match[1]), { text: match[3], matched: match[2] === ':' })
    return
  }
  if (marker === 'X') {
    completeContentResult(task)
    return
  }
  if (marker === 'D') {
    task.remoteDone = true
    return
  }
  if (marker === 'F') {
    finishSearch(task, 'failed', decodeBase64(fields[1]) || '远端搜索失败')
  }
}

function buildRemoteScript(request: RemoteSearchRequest): string {
  const script = `
set +e
root=$1
query=$2
matcher=$3
limit_bytes=$4
include_mounts=$5
mode=$6
include_system=$7
if [[ "$matcher" == 'regex' ]]; then
  grep -E -- "$query" /dev/null >/dev/null 2>&1
  regex_status=$?
  if (( regex_status > 1 )); then
    printf 'F\\0%s\\0' "$(printf '%s' '正则表达式无效，请检查表达式语法' | base64 -w0)"
    exit 2
  fi
fi
mount_paths=()
if [[ "$include_mounts" != '1' ]]; then
  if [[ ! -r /proc/self/mountinfo ]]; then
    printf 'F\\0%s\\0' "$(printf '%s' '无法读取挂载信息，不能安全限定搜索范围' | base64 -w0)"
    exit 2
  fi
  while IFS=' ' read -r mount_id parent_id device filesystem_root encoded_mount rest; do
    printf -v mount_path '%b' "$encoded_mount"
    [[ "$mount_path" == "$root" ]] && continue
    if [[ "$root" == '/' ]]; then
      [[ "$mount_path" == /* && "$mount_path" != '/' ]] || continue
    else
      [[ "$mount_path" == "$root/"* ]] || continue
    fi
    if [[ "$include_system" == '1' && "$root" == '/' ]]; then
      case "$mount_path" in /proc|/sys|/dev|/run) continue ;; esac
    fi
    mount_paths+=("$mount_path")
  done < /proc/self/mountinfo
fi
if [[ "$root" == '/' && "$include_system" != '1' ]]; then
  mount_paths+=(/proc /sys /dev /run)
fi

escape_find_pattern() {
  local value=$1 escaped='' character index
  for ((index = 0; index < \${#value}; index += 1)); do
    character=\${value:index:1}
    if [[ "$character" == '\\' || "$character" == '*' || "$character" == '?' || "$character" == '[' || "$character" == ']' ]]; then
      escaped+="\\\\$character"
    else
      escaped+="$character"
    fi
  done
  escaped_find_pattern=$escaped
}

find_args=("$root")
if (( \${#mount_paths[@]} > 0 )); then
  find_args+=( '(' )
  first_mount=1
  for mount_path in "\${mount_paths[@]}"; do
    if (( first_mount )); then first_mount=0; else find_args+=( -o ); fi
    escape_find_pattern "$mount_path"
    find_args+=( -path "$escaped_find_pattern" )
  done
  find_args+=( ')' -prune -printf 'P\\0%y\\0%s\\0%p\\0' -o )
fi
{
  scan_status=0
  find "\${find_args[@]}" -printf 'E\\0%y\\0%s\\0%p\\0' || {
    status=$?
    if (( status > 1 )); then scan_status=$status; fi
  }
  exit "$scan_status"
} | while IFS= read -r -d '' action; do
  IFS= read -r -d '' kind || break
  IFS= read -r -d '' size || break
  IFS= read -r -d '' path || break
  if [[ "$action" == 'P' ]]; then
    printf 'P\\0'
    continue
  fi
  if [[ "$action" == 'S' ]]; then
    printf 'S\\0'
    continue
  fi
  path64=$(printf '%s' "$path" | base64 -w0)
  printf 'E\\0%s\\0%s\\0%s\\0' "$kind" "$size" "$path64"
  if [[ "$mode" != 'content' ]]; then continue; fi
  if [[ "$kind" != 'f' ]]; then continue; fi
  if (( size > limit_bytes )); then
    printf 'S\\0'
    continue
  fi
  printf 'M\\0%s\\0%s\\0' "$path64" "$size"
  grep_flags=(-n -C 1 -I)
  if [[ "$matcher" == 'regex' ]]; then
    grep_flags+=(-E)
  else
    grep_flags+=(-F -i)
  fi
  grep "\${grep_flags[@]}" -- "$query" "$path" 2>/dev/null | while IFS= read -r line; do
    line64=$(printf '%s' "$line" | base64 -w0)
    printf 'L\\0%s\\0' "$line64"
  done
  grep_status=\${PIPESTATUS[0]}
  printf 'X\\0'
  if (( grep_status > 1 )); then printf 'I\\0'; fi
done
find_status=\${PIPESTATUS[0]}
if (( find_status > 1 )); then
  printf 'F\\0%s\\0' "$(printf '%s' '远端目录扫描失败' | base64 -w0)"
  exit "$find_status"
fi
printf 'D\\0%s\\0' "$find_status"
`
  return script
}

export function startRemoteSearch(input: RemoteSearchRequest): void {
  const request = validateRequest(input)
  if (activeSearches.has(request.requestId)) throw new Error('搜索请求编号已在使用')
  const session = sessions.get(request.sessionId)
  if (!session?.sftp || session.profileId !== request.profileId) throw new Error('SFTP 会话未连接')

  let expression: RegExp | null = null
  if (request.mode === 'name' && request.matcher === 'regex') expression = new RegExp(request.query)
  const task: SearchTask = {
    request,
    stream: null,
    finished: false,
    cancelled: false,
    remoteDone: false,
    exitCode: null,
    scannedEntries: 0,
    matchedFiles: 0,
    matchedLines: 0,
    skippedEntries: 0,
    incomplete: false,
    lastProgressAt: 0,
    results: [],
    bufferedResultBytes: 0,
    fields: [],
    pending: Buffer.alloc(0),
    flushTimer: null,
    currentEntry: null,
    contextLines: new Map(),
    decoder: new StringDecoder('utf8'),
    stderrRemainder: '',
    listeners: {},
  }
  activeSearches.set(request.requestId, task)
  const command = 'bash -c ' + shellQuote(buildRemoteScript(request)) + ' linux-nexus-search'
    + ' ' + [request.rootPath, request.query, request.matcher, String(request.maxFileSizeMiB * 1024 * 1024), request.includeMountedFilesystems ? '1' : '0', request.mode, request.includeSystemPaths ? '1' : '0']
      .map(shellQuote).join(' ')

  try {
    session.client.exec(command, (error, stream) => {
      if (error) {
        if (task.cancelled) finishSearch(task, 'cancelled')
        else finishSearch(task, 'failed', error.message || '无法启动远端搜索')
        return
      }
      task.stream = stream
      if (task.finished) {
        stream.close()
        return
      }
      task.listeners.data = (chunk) => {
        task.pending = Buffer.concat([task.pending, Buffer.from(chunk)])
        let delimiter = task.pending.indexOf(0)
        while (delimiter >= 0) {
          const field = task.pending.subarray(0, delimiter).toString('utf8')
          task.pending = task.pending.subarray(delimiter + 1)
          try {
            processField(task, field, expression)
          } catch (parseError) {
            stream.close()
            finishSearch(task, 'failed', parseError instanceof Error ? parseError.message : String(parseError))
            return
          }
          if (task.finished) return
          delimiter = task.pending.indexOf(0)
        }
      }
      task.listeners.stderr = (chunk) => {
        addStderr(task, Buffer.from(chunk))
        emitProgress(task)
      }
      task.listeners.error = (streamError) => {
        if (task.cancelled) finishSearch(task, 'cancelled')
        else finishSearch(task, 'failed', '搜索连接失败：' + streamError.message)
      }
      task.listeners.exit = (code) => {
        task.exitCode = typeof code === 'number' ? code : null
      }
      task.listeners.close = () => {
        if (task.finished) return
        addStderr(task, Buffer.alloc(0), true)
        if (task.cancelled) finishSearch(task, 'cancelled')
        else if (task.remoteDone && task.exitCode === 0) finishSearch(task, 'completed')
        else finishSearch(task, 'failed', task.remoteDone
          ? '远端搜索未能完整结束（退出码 ' + (task.exitCode ?? '未知') + '）'
          : 'SSH 连接中断，搜索已停止')
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

export function cancelRemoteSearch(requestId: string): boolean {
  const task = activeSearches.get(requestId)
  if (!task) return false
  task.cancelled = true
  if (task.contextLines.size > 0) completeContentResult(task)
  task.stream?.close()
  finishSearch(task, 'cancelled')
  return true
}

export function cancelSearchesForSession(sessionId: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId !== sessionId) continue
    cancelRemoteSearch(task.request.requestId)
  }
}

export function failSearchesForSession(sessionId: string, message: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId !== sessionId) continue
    const stream = task.stream
    finishSearch(task, 'failed', 'SSH 连接中断：' + message)
    stream?.close()
  }
}
