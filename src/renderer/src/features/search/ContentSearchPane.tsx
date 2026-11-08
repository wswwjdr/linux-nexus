import { msg, renderMessage, type MessageValue, tr } from '@shared/i18n/messages'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, LoaderCircle, Search } from 'lucide-react'
import type { ContentSearchEvent, ContentSearchProgress, ContentSearchRequest, ContentSearchResult } from '@shared/types'
import { SearchHistory, SearchScopeControl, isNormalizedAbsoluteRemotePath, readSearchHistory } from './SearchShared'
import { errorMessage, formatSize } from '@/app-utils'
import { ContentSearchResults } from './ContentSearchResults'
import { ResultMenu, emptyContentProgress, historyScopeLabel, initialContentConditions, isContentConditions, openMenu, statusLabel, MAX_QUERY_LENGTH, CONTENT_HISTORY_KEY, type ContentConditions, type ResultMenuState, type SearchPaneHandle, type SearchPaneProps, type SearchStatus } from './SearchPaneShared'

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
  const [error, setError] = useState<MessageValue | null>(null)
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
        setError(event.status === 'failed' ? event.message ?? msg('search.contentSearchFailed') : null)
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
  const elapsedLabel = seconds >= 60 ? tr('search.mS', { "value1": Math.floor(seconds / 60), "value2": String(seconds % 60).padStart(2, '0') }) : tr('search.s', { "seconds": seconds })

  return (
    <div className="search-dialog-body">
      <aside className="search-controls">
        <form onSubmit={(event) => void startSearch(event)}>
          <label className="field search-query-field">{tr('previews.textContent')}<input
              ref={queryRef}
              value={conditions.query}
              disabled={running}
              maxLength={MAX_QUERY_LENGTH}
              onChange={(event) => update('query', event.target.value)}
              placeholder={tr('search.enterTextToFind')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="search-checkbox search-case-option">
            <input type="checkbox" disabled={running} checked={conditions.ignoreCase} onChange={(event) => update('ignoreCase', event.target.checked)} />
            <span>{tr('search.ignoreCase')}</span>
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
            <summary>{tr('search.scanOptions')}</summary>
            <div className="search-advanced-options">
              <label className="field search-size-field">{tr('search.fileSizeLimitMib')}<input
                  type="number"
                  min="1"
                  max="102400"
                  step="1"
                  value={conditions.maxFileSizeMiB || ''}
                  disabled={running}
                  onChange={(event) => update('maxFileSizeMiB', event.target.value === '' ? 0 : Number(event.target.value))}
                />
                {invalidFileSize && <span className="search-field-error">{tr('search.enterAnIntegerFrom1To102400')}</span>}
              </label>
            </div>
          </details>
          <div className="search-form-actions">
            {running ? (
              <button type="button" className="secondary-button search-cancel-button" disabled={status === 'cancelling'} onClick={cancelSearch}>
                {status === 'cancelling' ? <LoaderCircle className="spin" size={14} /> : <span aria-hidden="true">×</span>}
                {status === 'cancelling' ? tr('transfers.cancelling') : tr('search.cancelSearch')}
              </button>
            ) : (
              <button type="submit" className="primary-button" disabled={!conditions.query || invalidFileSize || invalidPath}>
                <Search size={14} />{tr('search.search')}</button>
            )}
          </div>
        </form>
        <SearchHistory
          history={history}
          disabled={running}
          label={(item) => ({
            query: item.query,
            detail: tr('search.limitMib', { "value1": historyScopeLabel(item), "value2": item.ignoreCase ? tr('search.ignoreCase') : tr('search.caseSensitive'), "maxFileSizeMiB": item.maxFileSizeMiB }),
          })}
          onClear={clearHistory}
          onSelect={replayHistory}
        />
      </aside>

      <section className="search-results-panel" aria-label={tr('search.contentSearchResults')}>
        <div className="search-results-header">
          <div>
            <h3>{tr('search.searchResults')}</h3>
            <div className="search-status-line" aria-live="polite">
              {running && <LoaderCircle className="spin" size={13} />}
              <span>{statusLabel(status)}</span>
            </div>
          </div>
          <div className="search-counters">
            <span className="search-counter"><strong>{tr('search.matchedFiles', { count: progress.matchedFiles })}</strong></span>
            <span className="search-counter"><strong>{tr('search.matchedLines', { count: progress.matchedLines })}</strong></span>
            <span className="search-counter"><strong>{tr('search.filesScanned', { count: progress.processedFiles })}</strong></span>
            <span className="search-counter">{tr('search.elapsedSummary', { duration: elapsedLabel })}</span>
          </div>
        </div>
        {(progress.skippedLargeFiles > 0 || progress.skippedBinaryFiles > 0 || progress.readErrors > 0) && (
          <div className="search-incomplete-notice search-content-notices">
            {progress.skippedLargeFiles > 0 && <span><AlertTriangle size={14} />{tr('search.skippedLarge', { count: progress.skippedLargeFiles })}</span>}
            {progress.skippedBinaryFiles > 0 && <span><AlertTriangle size={14} />{tr('search.skippedBinary', { count: progress.skippedBinaryFiles })}</span>}
            {progress.readErrors > 0 && <span><AlertTriangle size={14} /> {tr('search.readFailures', { count: progress.readErrors })}</span>}
          </div>
        )}
        {error && <div className="search-error-notice" role="alert">{renderMessage(error)}</div>}
        <div className="search-progress-panel" aria-live="polite">
          <div className="search-progress-track"><div className={'search-progress-fill' + (running ? ' indeterminate' : '')} style={running ? undefined : { width: status === 'completed' ? '100%' : '0%' }} /></div>
          <div className="search-progress-summary">
            <span>{tr('search.scannedSummary', { size: formatSize(progress.processedBytes), elapsed: elapsedLabel })}</span>
            <span>{running ? formatByteRate(bytesPerSecond) : statusLabel(status)}</span>
          </div>
          {progress.currentPath && <div className="search-progress-path" title={progress.currentPath}>{progress.currentPath}</div>}
        </div>
        <ContentSearchResults
          results={results}
          query={conditions.query}
          ignoreCase={conditions.ignoreCase}
          running={running}
          status={status}
          menu={menu}
          onOpenMenu={(event, result) => setMenu(menu?.result.path === result.path ? null : openMenu(event, result))}
          onScroll={() => setMenu(null)}
        />
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

