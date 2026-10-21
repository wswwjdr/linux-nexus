import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  AlertTriangle,
  ChevronRight,
  Clock3,
  Eye,
  File,
  Folder,
  FolderOpen,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type {
  PreviewExtensions,
  PreviewType,
  RemoteSearchEvent,
  RemoteSearchRequest,
  RemoteSearchResult,
  RemoteSearchScope,
} from '@shared/types'
import ConfirmationDialog from './ConfirmationDialog'
import { remoteRegexError } from '@shared/search-utils'
import { previewFileTypes, previewTypeLabels } from '@shared/preview-file-type'
import { errorMessage, formatSize } from '@/app-utils'

type SearchConditions = Omit<RemoteSearchRequest, 'requestId' | 'profileId' | 'sessionId'>
type SearchStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

interface SearchDialogProps {
  sessionId: string
  profileId: string
  currentPath: string
  previewOpen: boolean
  previewExtensions: PreviewExtensions
  onClose: () => void
  onSelectResult: (result: RemoteSearchResult) => void
  onPreviewResult: (result: RemoteSearchResult, type: PreviewType) => void
}

interface ResultActionMenuState {
  result: RemoteSearchResult
  x: number
  y: number
  previewMenuOpen: boolean
}

const DEFAULT_MAX_FILE_SIZE_MIB = 100

function initialConditions(currentPath: string): SearchConditions {
  return {
    query: '',
    mode: 'name',
    matcher: 'literal',
    scope: 'current',
    rootPath: currentPath,
    maxFileSizeMiB: DEFAULT_MAX_FILE_SIZE_MIB,
    includeSystemPaths: false,
    includeMountedFilesystems: false,
  }
}

function isConditions(value: unknown): value is SearchConditions {
  if (!value || typeof value !== 'object') return false
  const conditions = value as Partial<SearchConditions>
  return typeof conditions.query === 'string'
    && (conditions.mode === 'name' || conditions.mode === 'content')
    && (conditions.matcher === 'literal' || conditions.matcher === 'regex')
    && (conditions.scope === 'current' || conditions.scope === 'root')
    && typeof conditions.rootPath === 'string'
    && typeof conditions.maxFileSizeMiB === 'number'
    && Number.isInteger(conditions.maxFileSizeMiB)
    && typeof conditions.includeSystemPaths === 'boolean'
    && typeof conditions.includeMountedFilesystems === 'boolean'
}

function readHistory(profileId: string): SearchConditions[] {
  const saved = window.localStorage.getItem('remote-files:search-history:' + profileId)
  if (!saved) return []
  try {
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter(isConditions).slice(0, 10) : []
  } catch {
    return []
  }
}

function validateExpression(query: string, matcher: SearchConditions['matcher']): string | null {
  if (matcher !== 'regex' || !query) return null
  return remoteRegexError(query)
}

function historyLabel(conditions: SearchConditions): string {
  const mode = conditions.mode === 'name' ? '文件名' : '文件内容'
  const scope = conditions.scope === 'root' ? '服务器根目录' : conditions.rootPath
  return mode + ' · ' + scope
}

function Counter({ label, value }: { label: string; value: number }) {
  return <span className="search-counter"><strong>{value.toLocaleString()}</strong> {label}</span>
}

export default function SearchDialog({ sessionId, profileId, currentPath, previewOpen, previewExtensions, onClose, onSelectResult, onPreviewResult }: SearchDialogProps) {
  const [conditions, setConditions] = useState(() => initialConditions(currentPath))
  const [history, setHistory] = useState(() => readHistory(profileId))
  const [results, setResults] = useState<RemoteSearchResult[]>([])
  const [resultActionMenu, setResultActionMenu] = useState<ResultActionMenuState | null>(null)
  const [resultMode, setResultMode] = useState<SearchConditions['mode']>('name')
  const [progress, setProgress] = useState({ scannedEntries: 0, matchedFiles: 0, matchedLines: 0, skippedEntries: 0, incomplete: false })
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const queryRef = useRef<HTMLInputElement>(null)
  const activeRequestRef = useRef<string | null>(null)
  const requestCloseRef = useRef<() => void>(() => {})
  const resultActionMenuRef = useRef(resultActionMenu)
  const resultActionMenuElementRef = useRef<HTMLDivElement>(null)
  const confirmCloseRef = useRef(confirmClose)
  const previewOpenRef = useRef(previewOpen)
  resultActionMenuRef.current = resultActionMenu
  confirmCloseRef.current = confirmClose
  previewOpenRef.current = previewOpen
  const running = status === 'running' || status === 'cancelling'
  const expressionError = useMemo(() => validateExpression(conditions.query, conditions.matcher), [conditions.query, conditions.matcher])
  const invalidFileSize = conditions.mode === 'content'
    && (!Number.isInteger(conditions.maxFileSizeMiB) || conditions.maxFileSizeMiB < 1 || conditions.maxFileSizeMiB > 102400)

  useEffect(() => {
    queryRef.current?.focus()
    const removeListener = window.remoteFiles.onSearchEvent((event: RemoteSearchEvent) => {
      if (event.requestId !== activeRequestRef.current) return
      setProgress({
        scannedEntries: event.scannedEntries,
        matchedFiles: event.matchedFiles,
        matchedLines: event.matchedLines,
        skippedEntries: event.skippedEntries,
        incomplete: event.incomplete,
      })
      if (event.type === 'results') setResults((current) => [...current, ...event.results])
      if (event.type === 'finished') {
        activeRequestRef.current = null
        setStatus(event.status)
        setError(event.status === 'failed' ? event.message ?? '搜索失败' : null)
      }
    })
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (previewOpenRef.current) return
        event.preventDefault()
        event.stopImmediatePropagation()
        if (resultActionMenuRef.current) {
          setResultActionMenu(null)
          return
        }
        if (confirmCloseRef.current) {
          setConfirmClose(false)
          return
        }
        requestCloseRef.current()
      }
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      removeListener()
      window.removeEventListener('keydown', dismissOnEscape, true)
      if (activeRequestRef.current) void window.remoteFiles.cancelSearch(activeRequestRef.current)
    }
  }, [])

  useEffect(() => {
    if (!resultActionMenu) return
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!resultActionMenuElementRef.current?.contains(event.target as Node)) setResultActionMenu(null)
    }
    const dismissOnResize = () => setResultActionMenu(null)
    window.addEventListener('pointerdown', dismissOnOutsidePointer, true)
    window.addEventListener('resize', dismissOnResize)
    resultActionMenuElementRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => {
      window.removeEventListener('pointerdown', dismissOnOutsidePointer, true)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [resultActionMenu])

  const update = <K extends keyof SearchConditions>(key: K, value: SearchConditions[K]) => {
    if (conditions[key] === value) return
    setConditions((current) => ({ ...current, [key]: value }))
    setResults([])
    setResultActionMenu(null)
    setProgress({ scannedEntries: 0, matchedFiles: 0, matchedLines: 0, skippedEntries: 0, incomplete: false })
    setStatus('idle')
    setError(null)
  }

  const rememberConditions = (nextConditions: SearchConditions) => {
    const nextHistory = [nextConditions, ...history.filter((item) => JSON.stringify(item) !== JSON.stringify(nextConditions))].slice(0, 10)
    setHistory(nextHistory)
    window.localStorage.setItem('remote-files:search-history:' + profileId, JSON.stringify(nextHistory))
  }

  const startSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (running || !conditions.query || expressionError) return
    const request: RemoteSearchRequest = {
      ...conditions,
      requestId: crypto.randomUUID(),
      sessionId,
      profileId,
    }
    activeRequestRef.current = request.requestId
    setResultMode(conditions.mode)
    setResults([])
    setResultActionMenu(null)
    setProgress({ scannedEntries: 0, matchedFiles: 0, matchedLines: 0, skippedEntries: 0, incomplete: false })
    setStatus('running')
    setError(null)
    rememberConditions(conditions)
    try {
      await window.remoteFiles.searchFiles(request)
    } catch (searchError) {
      if (activeRequestRef.current !== request.requestId) return
      activeRequestRef.current = null
      setStatus('failed')
      setError(errorMessage(searchError))
    }
  }

  const cancelSearch = () => {
    const requestId = activeRequestRef.current
    if (!requestId || status === 'cancelling') return
    setStatus('cancelling')
    void window.remoteFiles.cancelSearch(requestId).then((cancelled) => {
      if (!cancelled && activeRequestRef.current === requestId) {
        activeRequestRef.current = null
        setStatus('cancelled')
      }
    }).catch((cancelError) => {
      setError(errorMessage(cancelError))
    })
  }

  const requestClose = () => {
    if (running) {
      setConfirmClose(true)
      return
    }
    onClose()
  }
  requestCloseRef.current = requestClose

  const confirmPendingAction = () => {
    if (!confirmClose) return
    setConfirmClose(false)
    if (running) cancelSearch()
    onClose()
  }

  const replayHistory = (savedConditions: SearchConditions) => {
    setConditions({ ...savedConditions })
    setResultMode(savedConditions.mode)
    setResults([])
    setResultActionMenu(null)
    setProgress({ scannedEntries: 0, matchedFiles: 0, matchedLines: 0, skippedEntries: 0, incomplete: false })
    setError(null)
    setStatus('idle')
  }

  const clearHistory = () => {
    setHistory([])
    window.localStorage.removeItem('remote-files:search-history:' + profileId)
  }

  const changeScope = (scope: RemoteSearchScope) => {
    update('scope', scope)
    update('rootPath', scope === 'root' ? '/' : currentPath)
  }

  const openResultActionMenu = (event: ReactMouseEvent<HTMLButtonElement>, result: RemoteSearchResult) => {
    if (resultActionMenu?.result.path === result.path) {
      setResultActionMenu(null)
      return
    }
    const bounds = event.currentTarget.getBoundingClientRect()
    const menuWidth = 210
    const previewOptions = result.type === 'directory' ? [] : previewFileTypes(result.name, previewExtensions)
    const menuHeight = result.type === 'directory' ? 48
      : 84 + (previewOptions.length > 1 ? 38 + previewOptions.length * 31 : 0)
    const x = Math.max(8, Math.min(bounds.right - menuWidth, window.innerWidth - menuWidth - 8))
    const belowY = bounds.bottom + 6
    const y = belowY + menuHeight <= window.innerHeight - 8
      ? belowY
      : Math.max(8, bounds.top - menuHeight - 6)
    setResultActionMenu({ result, x, y, previewMenuOpen: false })
  }

  const statusText = status === 'running' ? '正在扫描'
    : status === 'cancelling' ? '正在取消'
      : status === 'completed' ? '搜索完成'
        : status === 'cancelled' ? '搜索已取消'
          : status === 'failed' ? '搜索失败'
            : '等待开始'

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <section className="modal search-modal" role="dialog" aria-modal="true" aria-labelledby="search-dialog-title">
        <header className="search-dialog-header">
          <div>
            <h2 id="search-dialog-title">搜索文件</h2>
          </div>
          <button className="icon-button modal-close" title="关闭搜索" aria-label="关闭搜索" onClick={requestClose}>
            <X size={17} />
          </button>
        </header>

        <div className="search-dialog-body">
          <aside className="search-controls">
            <form onSubmit={(event) => void startSearch(event)}>
              <label className="field search-query-field">
                搜索内容
                <input
                  ref={queryRef}
                  value={conditions.query}
                  disabled={running}
                  maxLength={4096}
                  onChange={(event) => update('query', event.target.value)}
                  placeholder="输入名称或文本片段"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              {expressionError && <div className="search-field-error" role="alert">{expressionError}</div>}

              <fieldset className="settings-view-field search-option-field">
                <legend>搜索类型</legend>
                <div className="settings-view-options">
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.mode === 'name'} onClick={() => update('mode', 'name')}>文件名</button>
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.mode === 'content'} onClick={() => update('mode', 'content')}>文件内容</button>
                </div>
              </fieldset>

              <fieldset className="settings-view-field search-option-field">
                <legend>搜索范围</legend>
                <div className="settings-view-options">
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.scope === 'current'} onClick={() => changeScope('current')}>当前目录</button>
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.scope === 'root'} onClick={() => changeScope('root')}>服务器根目录</button>
                </div>
                <div className="search-scope-path" title={conditions.rootPath}>{conditions.rootPath}</div>
              </fieldset>

              <fieldset className="settings-view-field search-option-field">
                <legend>匹配方式</legend>
                <div className="settings-view-options">
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matcher === 'literal'} onClick={() => update('matcher', 'literal')}>普通匹配</button>
                  <button type="button" className="settings-view-option" disabled={running} aria-pressed={conditions.matcher === 'regex'} onClick={() => update('matcher', 'regex')}>正则匹配</button>
                </div>
                <div className="search-matcher-hint">{conditions.matcher === 'literal' ? '忽略大小写' : '按表达式区分大小写'}</div>
              </fieldset>

              <details className="search-advanced">
                <summary><SlidersHorizontal size={14} /> 高级选项</summary>
                <div className="search-advanced-options">
                  {conditions.mode === 'content' && (
                    <label className="field search-size-field">
                      跳过大于此大小的文件（MiB）
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
                  )}
                  {conditions.rootPath === '/' && (
                    <label className="search-checkbox">
                      <input type="checkbox" disabled={running} checked={conditions.includeSystemPaths} onChange={(event) => update('includeSystemPaths', event.target.checked)} />
                      <span>搜索 /proc、/sys、/dev 和 /run</span>
                    </label>
                  )}
                  <label className="search-checkbox">
                    <input type="checkbox" disabled={running} checked={conditions.includeMountedFilesystems} onChange={(event) => update('includeMountedFilesystems', event.target.checked)} />
                    <span>搜索挂载文件系统</span>
                  </label>
                </div>
              </details>

              <div className="search-form-actions">
                {running ? (
                  <button type="button" className="secondary-button search-cancel-button" disabled={status === 'cancelling'} onClick={cancelSearch}>
                    {status === 'cancelling' ? <LoaderCircle className="spin" size={14} /> : <X size={14} />}
                    {status === 'cancelling' ? '正在取消' : '取消搜索'}
                  </button>
                ) : (
                  <button type="submit" className="primary-button" disabled={!conditions.query || Boolean(expressionError) || invalidFileSize}>
                    <Search size={14} /> 搜索
                  </button>
                )}
              </div>
            </form>

            <section className="search-history" aria-label="最近搜索">
              <div className="search-history-heading">
                <h3><Clock3 size={14} /> 最近搜索</h3>
                {history.length > 0 && <button className="icon-button subtle" type="button" disabled={running} title="清空搜索历史" aria-label="清空搜索历史" onClick={clearHistory}><Trash2 size={14} /></button>}
              </div>
              {history.length ? (
                <div className="search-history-list">
                  {history.map((item, index) => (
                    <button className="search-history-item" type="button" disabled={running} key={JSON.stringify(item) + index} onClick={() => replayHistory(item)}>
                      <span className="search-history-query">{item.query}</span>
                      <span className="search-history-meta">{historyLabel(item)} · {item.matcher === 'regex' ? '正则' : '普通匹配'}</span>
                    </button>
                  ))}
                </div>
              ) : <p className="search-history-empty">暂无搜索历史</p>}
            </section>
          </aside>

          <section className="search-results-panel" aria-label="搜索结果">
            <div className="search-results-header">
              <div>
                <h3>搜索结果</h3>
                <div className="search-status-line" aria-live="polite">
                  {running && <LoaderCircle className="spin" size={13} />}
                  <span>{statusText}</span>
                </div>
              </div>
              <div className="search-counters">
                <Counter label="已扫描" value={progress.scannedEntries} />
                <Counter label={resultMode === 'content' ? '个文件' : '个结果'} value={progress.matchedFiles} />
                {resultMode === 'content' && <Counter label="命中行" value={progress.matchedLines} />}
                <Counter label="跳过" value={progress.skippedEntries} />
              </div>
            </div>
            {progress.incomplete && (
              <div className="search-incomplete-notice"><AlertTriangle size={14} /> 有路径无法读取，结果可能不完整</div>
            )}
            {error && <div className="search-error-notice" role="alert">{error}</div>}

            <div className="search-results-list" aria-live="polite" onScroll={() => setResultActionMenu(null)}>
              {results.map((result) => (
                <button
                  className="search-result"
                  key={result.path}
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={resultActionMenu?.result.path === result.path}
                  onClick={(event) => openResultActionMenu(event, result)}
                  title={'操作 ' + result.path}
                >
                  <span className="search-result-heading">
                    <span className={'search-result-icon ' + (result.type === 'directory' ? 'directory' : '')}>
                      {result.type === 'directory' ? <Folder size={16} /> : <File size={15} />}
                    </span>
                    <span className="search-result-title">{result.name}</span>
                    <span className="search-result-size">{formatSize(result.size)}</span>
                  </span>
                  <span className="search-result-path">{result.path}</span>
                  {result.matches.length > 0 && (
                    <span className="search-result-matches">
                      {result.matches.map((match, index) => (
                        <span className="search-match-block" key={match.lineNumber + ':' + index}>
                          {match.before && <span className="search-match-line context"><span>{match.before.lineNumber}</span><code>{match.before.text || ' '}</code></span>}
                          <span className="search-match-line hit"><span>{match.lineNumber}</span><code>{match.text || ' '}</code></span>
                          {match.after && <span className="search-match-line context"><span>{match.after.lineNumber}</span><code>{match.after.text || ' '}</code></span>}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              ))}
              {results.length === 0 && (
                <div className="search-results-empty">
                  {running ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
                  <span>{running ? '等待匹配结果' : status === 'completed' ? '没有找到匹配项' : '提交搜索后显示结果'}</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </section>
      {resultActionMenu && (
        <div
          className="search-result-action-menu"
          ref={resultActionMenuElementRef}
          role="menu"
          aria-label={resultActionMenu.result.name + '的操作'}
          style={{ left: resultActionMenu.x, top: resultActionMenu.y }}
        >
          {resultActionMenu.result.type !== 'directory' && (() => {
            const previewOptions = previewFileTypes(resultActionMenu.result.name, previewExtensions)
            if (previewOptions.length === 0) return null
            if (previewOptions.length === 1) return (
              <button
                type="button"
                className="search-result-action"
                role="menuitem"
                onClick={() => {
                  const { result } = resultActionMenu
                  setResultActionMenu(null)
                  onPreviewResult(result, previewOptions[0])
                }}
              >
                <Eye size={15} /> 预览
              </button>
            )
            return (
              <>
                <button
                  type="button"
                  className="search-result-action"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={resultActionMenu.previewMenuOpen}
                  onClick={() => setResultActionMenu((current) => current ? { ...current, previewMenuOpen: !current.previewMenuOpen } : current)}
                >
                  <Eye size={15} /> 预览方式 <ChevronRight size={14} />
                </button>
                {resultActionMenu.previewMenuOpen && (
                  <div className="search-result-preview-submenu" role="menu" aria-label="预览方式">
                    {previewOptions.map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="search-result-action"
                        role="menuitem"
                        onClick={() => {
                          const { result } = resultActionMenu
                          setResultActionMenu(null)
                          onPreviewResult(result, type)
                        }}
                      >
                        {previewTypeLabels[type]}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          })()}
          <button
            type="button"
            className="search-result-action"
            role="menuitem"
            onClick={() => {
              const { result } = resultActionMenu
              setResultActionMenu(null)
              onSelectResult(result)
            }}
          >
            <FolderOpen size={15} /> {resultActionMenu.result.type === 'directory' ? '打开文件夹' : '打开所在目录'}
          </button>
        </div>
      )}
      {confirmClose && (
        <ConfirmationDialog
          title={running ? '搜索仍在进行' : '搜索已完成'}
          description={running ? '取消搜索并关闭窗口吗？' : '关闭搜索窗口吗？'}
          tone="warning"
          confirmLabel={running ? '取消搜索并关闭' : '关闭搜索'}
          cancelLabel={running ? '继续搜索' : '返回搜索'}
          onConfirm={confirmPendingAction}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  )
}

