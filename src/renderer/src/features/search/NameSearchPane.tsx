import { msg, renderMessage, type MessageValue, tr } from '@shared/i18n/messages'
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

export const NameSearchPane = forwardRef<SearchPaneHandle, SearchPaneProps>(function NameSearchPane({
  sessionId,
  profileId,
  currentPath,
  active,
  fileTypeExtensions,
  onRunningChange,
  onMenuOpenChange,
  onMenuAction,
}, ref) {
  const historyKey = NAME_HISTORY_KEY + profileId
  const [conditions, setConditions] = useState(() => initialNameConditions(currentPath))
  const [history, setHistory] = useState(() => readSearchHistory(historyKey, isNameConditions))
  const [results, setResults] = useState<NameSearchResult[]>([])
  const [menu, setMenu] = useState<ResultMenuState | null>(null)
  const [progress, setProgress] = useState<NameSearchProgress>(emptyNameProgress)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [clockNow, setClockNow] = useState(Date.now())
  const [error, setError] = useState<MessageValue | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const activeRequestRef = useRef<string | null>(null)
  const menuAnchorRef = useRef<HTMLElement | null>(null)
  const receivedAtRef = useRef(Date.now())
  const running = status === 'running' || status === 'cancelling'
  const invalidPath = conditions.scope === 'custom' && !isNormalizedAbsoluteRemotePath(conditions.rootPath)
  menuAnchorRef.current = menu?.anchor ?? null

  useImperativeHandle(ref, () => ({ cancel: cancelSearch }))
  useEffect(() => onRunningChange(running), [onRunningChange, running])
  useEffect(() => onMenuOpenChange(Boolean(menu)), [menu, onMenuOpenChange])
  useEffect(() => {
    if (active) queryRef.current?.focus()
  }, [active])
  useEffect(() => {
    const removeListener = window.remoteFiles.onNameSearchEvent((event: NameSearchEvent) => {
      if (event.requestId !== activeRequestRef.current) return
      receivedAtRef.current = Date.now()
      setProgress({
        requestId: event.requestId,
        sessionId: event.sessionId,
        profileId: event.profileId,
        elapsedMs: event.elapsedMs,
        matchedFiles: event.matchedFiles,
        incomplete: event.incomplete,
        hasReadErrors: event.hasReadErrors,
      })
      if (event.type === 'results') setResults((current) => [...current, ...event.results])
      if (event.type === 'finished') {
        activeRequestRef.current = null
        setStatus(event.status)
        setError(event.status === 'failed' ? event.message ?? msg('search.filenameSearchFailed') : null)
      }
    })
    return () => {
      removeListener()
      if (activeRequestRef.current) void window.remoteFiles.cancelNameSearch(activeRequestRef.current)
    }
  }, [])
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])

  const update = <K extends keyof NameConditions>(key: K, value: NameConditions[K]) => {
    if (conditions[key] === value) return
    setConditions((current) => ({ ...current, [key]: value }))
    setResults([])
    setMenu(null)
    setProgress(emptyNameProgress())
    setStatus('idle')
    setError(null)
  }

  const remember = (value: NameConditions) => {
    const next = [value, ...history.filter((item) => JSON.stringify(item) !== JSON.stringify(value))].slice(0, 10)
    setHistory(next)
    window.localStorage.setItem(historyKey, JSON.stringify(next))
  }

  const startSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (running || !conditions.query || invalidPath) return
    const request: NameSearchRequest = {
      requestId: crypto.randomUUID(),
      sessionId,
      profileId,
      rootPath: conditions.rootPath,
      query: conditions.query,
      matchMode: conditions.matchMode,
      ignoreCase: conditions.ignoreCase,
    }
    activeRequestRef.current = request.requestId
    setResults([])
    setMenu(null)
    setProgress(emptyNameProgress())
    receivedAtRef.current = Date.now()
    setClockNow(Date.now())
    setStatus('running')
    setError(null)
    remember(conditions)
    try {
      await window.remoteFiles.startNameSearch(request)
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
    void window.remoteFiles.cancelNameSearch(requestId).then((cancelled) => {
      if (!cancelled && activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        setStatus('cancelled')
      }
    }).catch((cancelError) => setError(errorMessage(cancelError)))
  }

  const replayHistory = (saved: NameConditions) => {
    setConditions({ ...saved })
    setResults([])
    setMenu(null)
    setProgress(emptyNameProgress())
    setError(null)
    setStatus('idle')
  }
  const clearHistory = () => {
    setHistory([])
    window.localStorage.removeItem(historyKey)
  }
  const elapsedMs = progress.elapsedMs + (running ? Math.max(0, clockNow - receivedAtRef.current) : 0)
  const seconds = Math.floor(elapsedMs / 1000)
  const elapsedLabel = seconds >= 60 ? tr('search.mS', { "value1": Math.floor(seconds / 60), "value2": String(seconds % 60).padStart(2, '0') }) : tr('search.s', { "seconds": seconds })

  return (
    <div className="search-dialog-body">
      <aside className="search-controls">
        <form onSubmit={(event) => void startSearch(event)}>
          <label className="field search-query-field">{tr('search.filename')}<input
              ref={queryRef}
              value={conditions.query}
              disabled={running}
              maxLength={MAX_QUERY_LENGTH}
              onChange={(event) => update('query', event.target.value)}
              placeholder={tr('search.enterAFilenameToFind')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <fieldset className="settings-view-field search-option-field">
            <legend>{tr('search.matchMode')}</legend>
            <div className="settings-view-options">
              <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matchMode === 'exact'} onClick={() => update('matchMode', 'exact')}>{tr('search.exactFilename')}</button>
              <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matchMode === 'contains'} onClick={() => update('matchMode', 'contains')}>{tr('search.nameContains')}</button>
            </div>
          </fieldset>
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
          <div className="search-form-actions">
            {running ? (
              <button type="button" className="secondary-button search-cancel-button" disabled={status === 'cancelling'} onClick={cancelSearch}>
                {status === 'cancelling' ? <LoaderCircle className="spin" size={14} /> : <span aria-hidden="true">×</span>}
                {status === 'cancelling' ? tr('transfers.cancelling') : tr('search.cancelSearch')}
              </button>
            ) : (
              <button type="submit" className="primary-button" disabled={!conditions.query || invalidPath}>
                <Search size={14} />{tr('search.search')}</button>
            )}
          </div>
        </form>
        <SearchHistory
          history={history}
          disabled={running}
          label={(item) => ({
            query: item.query,
            detail: historyScopeLabel(item) + ' · ' + (item.matchMode === 'exact' ? tr('search.exact') : tr('search.contains')) + ' · ' + (item.ignoreCase ? tr('search.ignoreCase') : tr('search.caseSensitive')),
          })}
          onClear={clearHistory}
          onSelect={replayHistory}
        />
      </aside>

      <section className="search-results-panel" aria-label={tr('search.filenameSearchResults')}>
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
            <span className="search-counter">{tr('search.elapsedSummary', { duration: elapsedLabel })}</span>
          </div>
        </div>
        {progress.hasReadErrors && (
          <div className="search-incomplete-notice"><AlertTriangle size={14} />{tr('search.somePathsCouldNotBeReadResultsMayBeIncomplete')}</div>
        )}
        {progress.incomplete && !progress.hasReadErrors && (
          <div className="search-incomplete-notice"><AlertTriangle size={14} />{tr('search.searchResultsMayBeIncomplete')}</div>
        )}
        {error && <div className="search-error-notice" role="alert">{renderMessage(error)}</div>}
        <div className="search-progress-panel" aria-live="polite">
          <div className="search-progress-track"><div className={'search-progress-fill' + (running ? ' indeterminate' : '')} style={running ? undefined : { width: status === 'completed' ? '100%' : '0%' }} /></div>
          <div className="search-progress-summary">
            <span>{running ? tr('search.findingFiles') : conditions.matchMode === 'exact' ? tr('search.matchTheExactFilename') : tr('search.matchTextWithinFilenames')}</span>
            <span>{conditions.ignoreCase ? tr('search.ignoreCase') : tr('search.caseSensitive')}</span>
          </div>
        </div>
        <NameVirtualResults
          results={results}
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

