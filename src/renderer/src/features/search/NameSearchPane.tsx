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
  const [error, setError] = useState<string | null>(null)
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
        setError(event.status === 'failed' ? event.message ?? '文件名搜索失败' : null)
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
  const elapsedLabel = seconds >= 60 ? Math.floor(seconds / 60) + '分' + String(seconds % 60).padStart(2, '0') + '秒' : seconds + '秒'

  return (
    <div className="search-dialog-body">
      <aside className="search-controls">
        <form onSubmit={(event) => void startSearch(event)}>
          <label className="field search-query-field">
            文件名
            <input
              ref={queryRef}
              value={conditions.query}
              disabled={running}
              maxLength={MAX_QUERY_LENGTH}
              onChange={(event) => update('query', event.target.value)}
              placeholder="输入要查找的文件名"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <fieldset className="settings-view-field search-option-field">
            <legend>匹配方式</legend>
            <div className="settings-view-options">
              <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matchMode === 'exact'} onClick={() => update('matchMode', 'exact')}>精确文件名</button>
              <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matchMode === 'contains'} onClick={() => update('matchMode', 'contains')}>名称包含</button>
            </div>
          </fieldset>
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
          <div className="search-form-actions">
            {running ? (
              <button type="button" className="secondary-button search-cancel-button" disabled={status === 'cancelling'} onClick={cancelSearch}>
                {status === 'cancelling' ? <LoaderCircle className="spin" size={14} /> : <span aria-hidden="true">×</span>}
                {status === 'cancelling' ? '正在取消' : '取消搜索'}
              </button>
            ) : (
              <button type="submit" className="primary-button" disabled={!conditions.query || invalidPath}>
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
            detail: historyScopeLabel(item) + ' · ' + (item.matchMode === 'exact' ? '精确' : '包含') + ' · ' + (item.ignoreCase ? '忽略大小写' : '区分大小写'),
          })}
          onClear={clearHistory}
          onSelect={replayHistory}
        />
      </aside>

      <section className="search-results-panel" aria-label="文件名搜索结果">
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
            <span className="search-counter"><strong>{elapsedLabel}</strong> 耗时</span>
          </div>
        </div>
        {progress.hasReadErrors && (
          <div className="search-incomplete-notice"><AlertTriangle size={14} /> 部分路径无法读取，结果可能不完整</div>
        )}
        {progress.incomplete && !progress.hasReadErrors && (
          <div className="search-incomplete-notice"><AlertTriangle size={14} /> 搜索结果可能不完整</div>
        )}
        {error && <div className="search-error-notice" role="alert">{error}</div>}
        <div className="search-progress-panel" aria-live="polite">
          <div className="search-progress-track"><div className={'search-progress-fill' + (running ? ' indeterminate' : '')} style={running ? undefined : { width: status === 'completed' ? '100%' : '0%' }} /></div>
          <div className="search-progress-summary">
            <span>{running ? '正在查找文件' : conditions.matchMode === 'exact' ? '精确匹配文件名' : '匹配文件名中的文字'}</span>
            <span>{conditions.ignoreCase ? '忽略大小写' : '区分大小写'}</span>
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

