import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { ClientChannel } from 'ssh2'
import type {
  ContentSearchEvent,
  ContentSearchLineMatch,
  ContentSearchProgress,
  ContentSearchRequest,
  ContentSearchResult,
  SearchRunStatus,
} from '@shared/types'
import { shellQuote } from '@shared/shell'
import { getMainWindow, sessions } from './runtime'
import { normalizedRemotePath } from './sftp-utils'

interface ContentSearchTask {
  request: ContentSearchRequest
  stream: ClientChannel | null
  finished: boolean
  cancelled: boolean
  remoteDone: boolean
  exitCode: number | null
  processedFiles: number
  processedBytes: number
  matchedFiles: number
  matchedLines: number
  skippedLargeFiles: number
  skippedBinaryFiles: number
  readErrors: number
  stderrReadErrors: number
  currentPath: string | null
  incomplete: boolean
  startedAt: number
  lastProgressAt: number
  progressTimer: ReturnType<typeof setTimeout> | null
  flushTimer: ReturnType<typeof setTimeout> | null
  results: ContentSearchResult[]
  bufferedResultBytes: number
  currentEntry: ContentSearchResult | null
  contextLines: Map<number, { text: string; matched: boolean }>
  fields: string[]
  pending: Buffer
  stderrDecoder: StringDecoder
  stderrRemainder: string
  listeners: {
    data?: (chunk: Buffer) => void
    stderr?: (chunk: Buffer) => void
    error?: (error: Error) => void
    exit?: (code: number | null) => void
    close?: () => void
  }
}

const activeSearches = new Map<string, ContentSearchTask>()
const RESULT_BATCH_SIZE = 10
const MAX_QUERY_LENGTH = 4096
const MAX_PATH_LENGTH = 4096
const MAX_FILE_SIZE_MIB = 102400

function validateRequest(value: ContentSearchRequest): ContentSearchRequest {
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
    || typeof value.ignoreCase !== 'boolean'
    || typeof value.maxFileSizeMiB !== 'number' || !Number.isInteger(value.maxFileSizeMiB)
    || value.maxFileSizeMiB < 1 || value.maxFileSizeMiB > MAX_FILE_SIZE_MIB) {
    throw new Error('文本内容搜索条件无效')
  }
  const rootPath = normalizedRemotePath(value.rootPath)
  if (!value.rootPath.startsWith('/') || rootPath !== value.rootPath) {
    throw new Error('搜索范围必须是规范化的绝对远端路径')
  }
  return value
}

function progress(task: ContentSearchTask): ContentSearchProgress {
  return {
    requestId: task.request.requestId,
    sessionId: task.request.sessionId,
    profileId: task.request.profileId,
    elapsedMs: Date.now() - task.startedAt,
    processedFiles: task.processedFiles,
    processedBytes: task.processedBytes,
    matchedFiles: task.matchedFiles,
    matchedLines: task.matchedLines,
    skippedLargeFiles: task.skippedLargeFiles,
    skippedBinaryFiles: task.skippedBinaryFiles,
    readErrors: task.readErrors,
    currentPath: task.currentPath,
    incomplete: task.incomplete,
  }
}

function sendEvent(event: ContentSearchEvent): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('files:content-search-event', event)
}

function emitProgress(task: ContentSearchTask, force = false): void {
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

function flushResults(task: ContentSearchTask): void {
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

function queueResult(task: ContentSearchTask, result: ContentSearchResult): void {
  task.results.push(result)
  task.bufferedResultBytes += (result.name.length + result.path.length
    + result.matches.reduce((total, match) => total + match.text.length
      + (match.before?.text.length ?? 0) + (match.after?.text.length ?? 0), 0)) * 2
  if (task.results.length >= RESULT_BATCH_SIZE || task.bufferedResultBytes >= 1024 * 1024) flushResults(task)
  else if (!task.flushTimer) task.flushTimer = setTimeout(() => flushResults(task), 200)
}

function finishSearch(task: ContentSearchTask, status: SearchRunStatus, message?: string): void {
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
  if (task.listeners.error) stream.removeListener('error', task.listeners.error)
  if (task.listeners.exit) stream.removeListener('exit', task.listeners.exit)
  if (task.listeners.close) stream.removeListener('close', task.listeners.close)
  if (task.listeners.stderr) stream.stderr.removeListener('data', task.listeners.stderr)
}

function addStderr(task: ContentSearchTask, chunk: Buffer, flush = false): void {
  task.stderrRemainder += task.stderrDecoder.write(chunk)
  const lines = task.stderrRemainder.split(/\r?\n/)
  task.stderrRemainder = lines.pop() ?? ''
  if (flush) {
    task.stderrRemainder += task.stderrDecoder.end()
    if (task.stderrRemainder.trim()) lines.push(task.stderrRemainder)
    task.stderrRemainder = ''
  }
  if (!lines.some((line) => line.trim())) return
  task.incomplete = true
  const count = lines.filter((line) => line.trim()).length
  task.stderrReadErrors += count
  task.readErrors += count
  emitProgress(task)
}

function decodeBase64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8')
}

function protocolInteger(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('远端内容搜索响应格式无效')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) throw new Error('远端内容搜索计数超出支持范围')
  return parsed
}

function completeCurrentResult(task: ContentSearchTask): void {
  if (!task.currentEntry || !task.contextLines) return
  const hits = [...task.contextLines.entries()]
    .filter(([, line]) => line.matched)
    .sort(([left], [right]) => left - right)
  if (hits.length) {
    const matches: ContentSearchLineMatch[] = hits.map(([lineNumber]) => {
      const before = task.contextLines.get(lineNumber - 1)
      const after = task.contextLines.get(lineNumber + 1)
      return {
        lineNumber,
        ...(before ? { before: { lineNumber: lineNumber - 1, text: before.text } } : {}),
        text: task.contextLines.get(lineNumber)!.text,
        ...(after ? { after: { lineNumber: lineNumber + 1, text: after.text } } : {}),
      }
    })
    queueResult(task, { ...task.currentEntry, matches })
  }
  task.currentEntry = null
  task.contextLines = new Map()
}

function processField(task: ContentSearchTask, field: string): void {
  task.fields.push(field)
  const marker = task.fields[0]
  const fieldCount = marker === 'P' ? 9 : marker === 'R' ? 3 : marker === 'L' || marker === 'F' ? 2 : marker === 'Z' ? 1 : marker === 'D' ? 8 : 0
  if (!fieldCount) {
    task.fields = []
    throw new Error('远端内容搜索响应格式无效')
  }
  if (task.fields.length < fieldCount) return
  const fields = task.fields
  task.fields = []
  if (marker === 'P') {
    task.processedFiles = protocolInteger(fields[1])
    task.processedBytes = protocolInteger(fields[2])
    task.matchedFiles = protocolInteger(fields[3])
    task.matchedLines = protocolInteger(fields[4])
    task.skippedLargeFiles = protocolInteger(fields[5])
    task.skippedBinaryFiles = protocolInteger(fields[6])
    task.readErrors = protocolInteger(fields[7]) + task.stderrReadErrors
    task.currentPath = fields[8] ? decodeBase64(fields[8]) : null
    task.incomplete = task.readErrors > 0 || task.incomplete
    emitProgress(task)
    return
  }
  if (marker === 'R') {
    if (task.currentEntry) throw new Error('远端内容搜索结果未正确结束')
    const path = decodeBase64(fields[2])
    task.currentEntry = {
      name: posix.basename(path),
      path,
      type: 'file',
      size: protocolInteger(fields[1]),
      matches: [],
    }
    task.currentPath = path
    task.contextLines = new Map()
    return
  }
  if (marker === 'L') {
    const line = decodeBase64(fields[1])
    if (!task.contextLines) return
    const match = /^(\d+)([:\-])(.*)$/.exec(line)
    if (!match) throw new Error('远端内容搜索行响应格式无效')
    task.contextLines.set(Number(match[1]), { text: match[3], matched: match[2] === ':' })
    return
  }
  if (marker === 'Z') {
    if (!task.currentEntry) throw new Error('远端内容搜索结果缺少当前文件')
    completeCurrentResult(task)
    return
  }
  if (marker === 'D') {
    if (task.currentEntry) throw new Error('远端内容搜索结果未正确结束')
    task.processedFiles = protocolInteger(fields[1])
    task.processedBytes = protocolInteger(fields[2])
    task.matchedFiles = protocolInteger(fields[3])
    task.matchedLines = protocolInteger(fields[4])
    task.skippedLargeFiles = protocolInteger(fields[5])
    task.skippedBinaryFiles = protocolInteger(fields[6])
    task.readErrors = protocolInteger(fields[7]) + task.stderrReadErrors
    task.incomplete = task.readErrors > 0 || task.incomplete
    task.currentPath = null
    task.remoteDone = true
    return
  }
  if (marker === 'F') finishSearch(task, 'failed', decodeBase64(fields[1]) || '远端内容搜索失败')
}

export function buildContentSearchScript(): string {
  return `
set +e
root=$1
query=$2
ignore_case=$3
limit_bytes=$4
fail() {
  printf 'F\\0%s\\0' "$(printf '%s' "$1" | base64 -w0)"
  exit 2
}
if [[ ! -d "$root" ]]; then
  fail '搜索目录不存在或不可访问'
fi
processed_files=0
processed_bytes=0
matched_files=0
matched_lines=0
skipped_large_files=0
skipped_binary_files=0
read_errors=0
scanned_files=0
last_update=$SECONDS
last_path=''
emit_progress() {
  local path64=''
  if [[ -n "\${1:-}" ]]; then path64=$(printf '%s' "$1" | base64 -w0); fi
  printf 'P\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0' \\
    "$processed_files" "$processed_bytes" "$matched_files" "$matched_lines" \\
    "$skipped_large_files" "$skipped_binary_files" "$read_errors" "$path64"
}
grep_flags=(-F -H -n -C 1 -Z --no-group-separator)
if [[ "$ignore_case" == '1' ]]; then grep_flags+=(-i); fi
batch_paths=()
batch_sizes=()
flush_batch() {
  ((\${#batch_paths[@]})) || return 0
  local output_path line current_path='' current_size=0 current_has_result=0 index binary_path binary_prefix binary_found
  exec 4< <(grep "\${grep_flags[@]}" -- "$query" "\${batch_paths[@]}")
  local grep_pid=$!
  while IFS= read -r -d '' output_path <&4 || [[ -n "$output_path" ]]; do
    while [[ -n "$output_path" ]]; do
      if [[ "$output_path" == 'Binary file '* ]]; then
        binary_found=0
        for ((index = 0; index < \${#batch_paths[@]}; index++)); do
          binary_path=\${batch_paths[index]}
          binary_prefix="Binary file $binary_path matches"$'\\n'
          if [[ "$output_path" == "$binary_prefix"* ]]; then
            if [[ "$binary_path" != "$current_path" ]]; then
              if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
                printf 'Z\\0'
                matched_files=$((matched_files + 1))
              fi
              current_path=$binary_path
              current_size=\${batch_sizes[index]}
              current_has_result=0
            fi
            skipped_binary_files=$((skipped_binary_files + 1))
            output_path=\${output_path#"$binary_prefix"}
            binary_found=1
            break
          fi
        done
        if (( ! binary_found )); then
          read_errors=$((read_errors + 1))
          break 2
        fi
        continue
      fi
      IFS= read -r line <&4 || break 2
      if [[ "$output_path" != "$current_path" ]]; then
        if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
          printf 'Z\\0'
          matched_files=$((matched_files + 1))
        fi
        current_path=$output_path
        current_size=0
        current_has_result=0
        for ((index = 0; index < \${#batch_paths[@]}; index++)); do
          if [[ "\${batch_paths[index]}" == "$current_path" ]]; then
            current_size=\${batch_sizes[index]}
            break
          fi
        done
      fi
      if [[ ! "$line" =~ ^[0-9]+[:-] ]]; then
        read_errors=$((read_errors + 1))
        output_path=''
        continue
      fi
      if (( ! current_has_result )); then
        path64=$(printf '%s' "$current_path" | base64 -w0)
        printf 'R\\0%s\\0%s\\0' "$current_size" "$path64"
        current_has_result=1
      fi
      line64=$(printf '%s' "$line" | base64 -w0)
      printf 'L\\0%s\\0' "$line64"
      if [[ "$line" =~ ^[0-9]+: ]]; then matched_lines=$((matched_lines + 1)); fi
      output_path=''
    done
  done
  exec 4<&-
  wait "$grep_pid"
  if [[ -n "$current_path" && $current_has_result -eq 1 ]]; then
    printf 'Z\\0'
    matched_files=$((matched_files + 1))
  fi
  batch_paths=()
  batch_sizes=()
}
exec 3< <(find -- "$root" -type f -printf '%s\\0%p\\0')
find_pid=$!
while IFS= read -r -d '' size <&3; do
  IFS= read -r -d '' path <&3 || break
  scanned_files=$((scanned_files + 1))
  last_path=$path
  if (( size > limit_bytes )); then
    skipped_large_files=$((skipped_large_files + 1))
  else
    processed_files=$((processed_files + 1))
    processed_bytes=$((processed_bytes + size))
    batch_paths+=("$path")
    batch_sizes+=("$size")
    if (( \${#batch_paths[@]} >= 64 )); then flush_batch; fi
  fi
  if (( scanned_files % 250 == 0 || SECONDS > last_update )); then
    emit_progress "$path"
    last_update=$SECONDS
  fi
done
exec 3<&-
wait "$find_pid"
find_status=$?
flush_batch
emit_progress "$last_path"
printf 'D\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0%s\\0' \\
  "$processed_files" "$processed_bytes" "$matched_files" "$matched_lines" \\
  "$skipped_large_files" "$skipped_binary_files" "$read_errors"
exit "$find_status"
`
}

export function startContentSearch(input: ContentSearchRequest): void {
  const request = validateRequest(input)
  if (activeSearches.has(request.requestId)) throw new Error('文本内容搜索请求编号已在使用')
  const session = sessions.get(request.sessionId)
  if (!session?.sftp || session.profileId !== request.profileId) throw new Error('SFTP 会话未连接')

  const task: ContentSearchTask = {
    request,
    stream: null,
    finished: false,
    cancelled: false,
    remoteDone: false,
    exitCode: null,
    processedFiles: 0,
    processedBytes: 0,
    matchedFiles: 0,
    matchedLines: 0,
    skippedLargeFiles: 0,
    skippedBinaryFiles: 0,
    readErrors: 0,
    stderrReadErrors: 0,
    currentPath: null,
    incomplete: false,
    startedAt: Date.now(),
    lastProgressAt: 0,
    progressTimer: null,
    flushTimer: null,
    results: [],
    bufferedResultBytes: 0,
    currentEntry: null,
    contextLines: new Map(),
    fields: [],
    pending: Buffer.alloc(0),
    stderrDecoder: new StringDecoder('utf8'),
    stderrRemainder: '',
    listeners: {},
  }
  activeSearches.set(request.requestId, task)
  emitProgress(task, true)
  const command = 'bash -c ' + shellQuote(buildContentSearchScript()) + ' linux-nexus-content-search'
    + ' ' + [request.rootPath, request.query, request.ignoreCase ? '1' : '0', String(request.maxFileSizeMiB * 1024 * 1024)]
      .map(shellQuote).join(' ')

  try {
    session.client.exec(command, (error, stream) => {
      if (error) {
        finishSearch(task, task.cancelled ? 'cancelled' : 'failed', error.message || '无法启动文本内容搜索')
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
          const field = task.pending.subarray(0, delimiter).toString('utf8')
          task.pending = task.pending.subarray(delimiter + 1)
          try {
            processField(task, field)
          } catch (parseError) {
            stream.close()
            finishSearch(task, 'failed', parseError instanceof Error ? parseError.message : String(parseError))
            return
          }
          if (task.finished) return
          delimiter = task.pending.indexOf(0)
        }
      }
      task.listeners.stderr = (chunk) => addStderr(task, Buffer.from(chunk))
      task.listeners.error = (streamError) => {
        if (task.cancelled) finishSearch(task, 'cancelled')
        else finishSearch(task, 'failed', '文本内容搜索连接失败：' + streamError.message)
      }
      task.listeners.exit = (code) => {
        task.exitCode = typeof code === 'number' ? code : null
      }
      task.listeners.close = () => {
        if (task.finished) return
        addStderr(task, Buffer.alloc(0), true)
        if (task.cancelled) finishSearch(task, 'cancelled')
        else if (task.remoteDone && (task.exitCode === 0 || (task.exitCode === 1 && task.incomplete))) finishSearch(task, 'completed')
        else finishSearch(task, 'failed', task.remoteDone
          ? '远端文本内容搜索未能完整结束（退出码 ' + (task.exitCode ?? '未知') + '）'
          : 'SSH 连接中断，文本内容搜索已停止')
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

export function cancelContentSearch(requestId: string): boolean {
  const task = activeSearches.get(requestId)
  if (!task) return false
  task.cancelled = true
  task.stream?.close()
  finishSearch(task, 'cancelled')
  return true
}

export function cancelContentSearchesForSession(sessionId: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) cancelContentSearch(task.request.requestId)
  }
}

export function failContentSearchesForSession(sessionId: string, message: string): void {
  for (const task of activeSearches.values()) {
    if (task.request.sessionId === sessionId) finishSearch(task, 'failed', message)
  }
}
