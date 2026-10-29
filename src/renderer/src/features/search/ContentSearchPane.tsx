import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { AlertTriangle, File, LoaderCircle, Search } from 'lucide-react'
import type {
  ContentSearchEvent,
  ContentSearchProgress,
  ContentSearchRequest,
  ContentSearchResult,
  FileTypeExtensions,
  NameSearchEvent,
  NameSearchMatchMode,
  NameSearchProgress,
  NameSearchRequest,
  NameSearchResult,
  SearchResultTarget,
} from '@shared/types'
import FileContextMenu from '@/features/files/FileContextMenu'
import { SearchHistory, SearchScopeControl, type SearchScopeConditions, isNormalizedAbsoluteRemotePath, readSearchHistory } from './SearchShared'
import type { FileContextMenuContext, FileMenuAction } from '@/features/files/file-menu'
import { errorMessage, formatSize } from '@/app-utils'

import { NameVirtualResults, ResultMenu, emptyNameProgress, emptyContentProgress, historyScopeLabel, initialNameConditions, initialContentConditions, isNameConditions, isContentConditions, openMenu, statusLabel, MAX_QUERY_LENGTH, NAME_HISTORY_KEY, CONTENT_HISTORY_KEY, DEFAULT_MAX_FILE_SIZE_MIB, type NameConditions, type ContentConditions, type ResultMenuState, type SearchPaneHandle, type SearchPaneProps, type SearchStatus } from './SearchPaneShared'

export const ContentSearchPane = forwardRef<SearchPaneHandle, SearchPaneProps>(function ContentSearchPane({
  sessionId,
  profileId,
  currentPath,
  active,
  fileTypeExtensions,
  onRunningChange,
  onMenuOpenChange,
  onMenuAction,
}, ref) {
  const historyKey = CONTENT_HISTORY_KEY + profileId
  const [conditions, setConditions] = useState(() => initialContentConditions(currentPath))
  const [history, setHistory] = useState(() => readSearchHistory(historyKey, isContentConditions))
  const [results, setResults] = useState<ContentSearchResult[]>([])
  const [menu, setMenu] = useState<ResultMenuState | null>(null)
  const [progress, setProgress] = useState<ContentSearchProgress>(emptyContentProgress)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [clockNow, setClockNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const activeRequestRef = useRef<string | null>(null)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const receivedAtRef = useRef(Date.now())
  const running = status === 'running' || status === 'cancelling'
  const invalidFileSize = !Number.isInteger(conditions.maxFileSizeMiB) || conditions.maxFileSizeMiB < 1 || conditions.maxFileSizeMiB > 102400
  const invalidPath = conditions.scope === 'custom' && !isNormalizedAbsoluteRemotePath(conditions.rootPath)
  menuAnchorRef.current = menu?.anchor ?? null

  useImperativeHandle(ref, () => ({ cancel: cancelSearch }))
  useEffect(() => onRunningChange(running), [onRunningChange, running])
  useEffect(() => onMenuOpenChange(Boolean(menu)), [menu, onMenuOpenChange])
  useEffect(() => {
    if (active) queryRef.current?.focus()
  }, [active])
  useEffect(() => {
    const removeListener = window.remoteFiles.onContentSearchEvent((event: ContentSearchEvent) => {
      if (event.requestId !== activeRequestRef.current) return
      receivedAtRef.current = Date.now()
      setProgress({
        requestId: event.requestId,
        sessionId: event.sessionId,
        profileId: event.profileId,
        elapsedMs: event.elapsedMs,
        processedFiles: event.processedFiles,
        processedBytes: event.processedBytes,
        matchedFiles: event.matchedFiles,
        matchedLines: event.matchedLines,
        skippedLargeFiles: event.skippedLargeFiles,
        skippedBinaryFiles: event.skippedBinaryFiles,
        readErrors: event.readErrors,
        currentPath: event.currentPath,
        incomplete: event.incomplete,
      })
      if (event.type === 'results') setResults((current) => [...current, ...event.results])
      if (event.type === 'finished') {
        activeRequestRef.current = null
        setStatus(event.status)
        setError(event.status === 'failed' ? event.message ?? '文本内容搜索失败' : null)
      }
    })
    return () => {
      removeListener()
      if (activeRequestRef.current) void window.remoteFiles.cancelContentSearch(activeRequestRef.current)
    }
  }, [])
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const update = <K extends keyof ContentConditions>(key: K, value: ContentConditions[K]) => {
    if (conditions[key] === value) return
    setConditions((current) => ({ ...current, [key]: value }))
    setResults([])
    setMenu(null)
    setProgress(emptyContentProgress())
    setStatus('idle')
    setError(null)
  }

  const remember = (value: ContentConditions) => {
    const next = [value, ...history.filter((item) => JSON.stringify(item) !== JSON.stringify(value))].slice(0, 10)
    setHistory(next)
    window.localStorage.setItem(historyKey, JSON.stringify(next))
  }

  const startSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (running || !conditions.query || invalidFileSize || invalidPath) return
    const request: ContentSearchRequest = {
      requestId: crypto.randomUUID(),
      sessionId,
      profileId,
      rootPath: conditions.rootPath,
      query: conditions.query,
      ignoreCase: conditions.ignoreCase,
      maxFileSizeMiB: conditions.maxFileSizeMiB,
    }
    activeRequestRef.current = request.requestId
    setResults([])
    setMenu(null)
    setProgress(emptyContentProgress())
    receivedAtRef.current = Date.now()
    setClockNow(Date.now())
    setStatus('running')
    setError(null)
    remember(conditions)
    try {
      await window.remoteFiles.startContentSearch(request)
    } catch (searchError) {
      if (activeRequestRef.current !== request.requestId) return
      activeRequestRef.current = null
      setStatus('failed')
      setError(errorMessage(searchError))
    }
  }

  function cancelSearch() {
    const requestId = activeRequestRef.current
    if (!requestId || status === 'cancelling') return
    setStatus('cancelling')
    void window.remoteFiles.cancelContentSearch(requestId).then((cancelled) => {
      if (!cancelled && activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        setStatus('cancelled')
      }
    }).catch((cancelError) => setError(errorMessage(cancelError)))
  }

  const replayHistory = (saved: ContentConditions) => {
    setConditions({ ...saved })
    setResults([])
    setMenu(null)
    setProgress(emptyContentProgress())
    setError(null)
    setStatus('idle')
  }
  const clearHistory = () => {
    setHistory([])
    window.localStorage.removeItem(historyKey)
  }
  const elapsedMs = progress.elapsedMs + (running ? Math.max(0, clockNow - receivedAtRef.current) : 0)
  const bytesPerSecond = elapsedMs > 0 ? progress.processedBytes / (elapsedMs / 1000) : 0
  const seconds = Math.floor(elapsedMs / 1000)
  const elapsedLabel = seconds >= 60 ? Math.floor(seconds / 60) + '分' + String(seconds % 60).padStart(2, '0') + '秒' : seconds + '秒'

  return (
    <div className="search-dialog-body">
      <aside className="search-controls">
        <form onSubmit={(event) => void startSearch(event)}>
          <label className="field search-query-field">
            文本内容
            <input
              ref={queryRef}
              value={conditions.query}
              disabled={running}
              maxLength={MAX_QUERY_LENGTH}
              onChange={(event) => update('query', event.target.value)}
              placeholder="输入要查找的文本片段"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="search-checkbox search-case-option">
            <input type="checkbox" disabled={running} checked={conditions.ignoreCase} onChange={(event) => update('ignoreCase', event.target.checked)} />
            <span>忽略大小写</span>
          </label>
          <SearchScopeControl
            scope={conditions.scope}
            rootPath={conditions.rootPath}
            currentPath={currentPath}
            disabled={running}
            onScopeChange={(scope, rootPath) => {
              update('scope', scope)
              update('rootPath', rootPath)
            }}
            onRootPathChange={(rootPath) => update('rootPath', rootPath)}
          />
          <details className="search-advanced" open>
            <summary>扫描选项</summary>
            <div className="search-advanced-options">
              <label className="field search-size-field">
                文件大小上限（MiB）
                <input
                  type="number"
                  min="1"
                  max="102400"
                  step="1"
                  value={conditions.maxFileSizeMiB || ''}
                  disabled={running}
                  onChange={(event) => update('maxFileSizeMiB', event.target.value === '' ? 0 : Number(event.target.value))}
                />
                {invalidFileSize && <span className="search-field-error">请输入 1 到 102400 之间的整数</span>}
              </label>
            </div>
          </details>
          <div className="search-form-actions">
            {running ? (
              <button type="button" className="secondary-button search-cancel-button" disabled={status === 'cancelling'} onClick={cancelSearch}>
                {status === 'cancelling' ? <LoaderCircle className="spin" size={14} /> : <span aria-hidden="true">×</span>}
                {status === 'cancelling' ? '正在取消' : '取消搜索'}
              </button>
            ) : (
              <button type="submit" className="primary-button" disabled={!conditions.query || invalidFileSize || invalidPath}>
                <Search size={14} /> 搜索
              </button>
            )}
          </div>
        </form>
        <SearchHistory
          history={history}
          disabled={running}
          label={(item) => ({
            query: item.query,
            detail: historyScopeLabel(item) + ' · ' + (item.ignoreCase ? '忽略大小写' : '区分大小写') + ' · 上限 ' + item.maxFileSizeMiB + ' MiB',
          })}
          onClear={clearHistory}
          onSelect={replayHistory}
        />
      </aside>

      <section className="search-results-panel" aria-label="文本内容搜索结果">
        <div className="search-results-header">
          <div>
            <h3>搜索结果</h3>
            <div className="search-status-line" aria-live="polite">
              {running && <LoaderCircle className="spin" size={13} />}
              <span>{statusLabel(status)}</span>
            </div>
          </div>
          <div className="search-counters">
            <span className="search-counter"><strong>{progress.matchedFiles.toLocaleString()}</strong> 个文件</span>
            <span className="search-counter"><strong>{progress.matchedLines.toLocaleString()}</strong> 行</span>
            <span className="search-counter"><strong>{progress.processedFiles.toLocaleString()}</strong> 已扫描</span>
            <span className="search-counter"><strong>{elapsedLabel}</strong> 耗时</span>
          </div>
        </div>
        {(progress.skippedLargeFiles > 0 || progress.skippedBinaryFiles > 0 || progress.readErrors > 0) && (
          <div className="search-incomplete-notice search-content-notices">
            {progress.skippedLargeFiles > 0 && <span><AlertTriangle size={14} /> 已跳过 {progress.skippedLargeFiles.toLocaleString()} 个超出大小上限的文件</span>}
            {progress.skippedBinaryFiles > 0 && <span><AlertTriangle size={14} /> 已跳过 {progress.skippedBinaryFiles.toLocaleString()} 个包含匹配内容的二进制文件</span>}
            {progress.readErrors > 0 && <span><AlertTriangle size={14} /> {progress.readErrors.toLocaleString()} 个路径读取失败，结果可能不完整</span>}
          </div>
        )}
        {error && <div className="search-error-notice" role="alert">{error}</div>}
        <div className="search-progress-panel" aria-live="polite">
          <div className="search-progress-track"><div className={'search-progress-fill' + (running ? ' indeterminate' : '')} style={running ? undefined : { width: status === 'completed' ? '100%' : '0%' }} /></div>
          <div className="search-progress-summary">
            <span>{formatSize(progress.processedBytes)} scanned · {elapsedLabel}</span>
            <span>{running ? formatByteRate(bytesPerSecond) : statusLabel(status)}</span>
          </div>
          {progress.currentPath && <div className="search-progress-path" title={progress.currentPath}>{progress.currentPath}</div>}
        </div>
        <div className="search-results-list content-search-results-list" aria-live="off" onScroll={() => setMenu(null)}>
          {results.map((result) => (
            <button
              className="search-result content-search-result"
              key={result.path}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menu?.result.path === result.path}
              onClick={(event) => setMenu(menu?.result.path === result.path ? null : openMenu(event, result))}
              title={'操作 ' + result.path}
            >
              <span className="search-result-heading">
                <span className="search-result-icon"><File size={15} /></span>
                <span className="search-result-title">{result.name}</span>
                <span className="search-result-size">{formatSize(result.size)}</span>
              </span>
              <span className="search-result-path">{result.path}</span>
              <span className="search-result-matches">
                {result.matches.map((match, index) => (
                  <span className="search-match-block" key={match.lineNumber + ':' + index}>
                    {match.before && <span className="search-match-line context"><span>{match.before.lineNumber}</span><code>{match.before.text || ' '}</code></span>}
                    <span className="search-match-line hit"><span>{match.lineNumber}</span><code>{match.text || ' '}</code></span>
                    {match.after && <span className="search-match-line context"><span>{match.after.lineNumber}</span><code>{match.after.text || ' '}</code></span>}
                  </span>
                ))}
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <div className="search-results-empty">
              {running ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
              <span>{running ? '等待匹配结果' : status === 'completed' ? '没有找到匹配内容' : '提交搜索后显示结果'}</span>
            </div>
          )}
        </div>
      </section>
      <ResultMenu
        menu={menu}
        anchorRef={menuAnchorRef}
        fileTypeExtensions={fileTypeExtensions}
        onAction={onMenuAction}
        onClose={() => setMenu(null)}
      />
    </div>
  )
})

function formatByteRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return Math.round(bytesPerSecond) + ' B/s'
  if (bytesPerSecond < 1024 * 1024) return (bytesPerSecond / 1024).toFixed(1) + ' KiB/s'
  return (bytesPerSecond / (1024 * 1024)).toFixed(1) + ' MiB/s'
}

