import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  Clock3,
  File,
  Folder,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import type {
  RemoteSearchEvent,
  RemoteSearchRequest,
  RemoteSearchResult,
  RemoteSearchScope,
} from '@shared/types'
import { remoteRegexError } from '@shared/search-utils'
import { errorMessage, formatSize } from '../app-utils'

type SearchConditions = Omit<RemoteSearchRequest, 'requestId' | 'profileId'>
type SearchStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

interface SearchDialogProps {
  profileId: string
  currentPath: string
  onClose: () => void
  onSelectResult: (result: RemoteSearchResult) => void
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

export default function SearchDialog({ profileId, currentPath, onClose, onSelectResult }: SearchDialogProps) {
  const [conditions, setConditions] = useState(() => initialConditions(currentPath))
  const [history, setHistory] = useState(() => readHistory(profileId))
  const [results, setResults] = useState<RemoteSearchResult[]>([])
  const [resultMode, setResultMode] = useState<SearchConditions['mode']>('name')
  const [progress, setProgress] = useState({ scannedEntries: 0, matchedFiles: 0, matchedLines: 0, skippedEntries: 0, incomplete: false })
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const queryRef = useRef<HTMLInputElement>(null)
  const activeRequestRef = useRef<string | null>(null)
  const requestCloseRef = useRef<() => void>(() => {})
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
        event.preventDefault()
        event.stopImmediatePropagation()
        requestCloseRef.current()
      }
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      removeListener()
      window.removeEventListener('keydown', dismissOnEscape, true)
    }
  }, [])

  const update = <K extends keyof SearchConditions>(key: K, value: SearchConditions[K]) => {
    if (conditions[key] === value) return
    setConditions((current) => ({ ...current, [key]: value }))
    setResults([])
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
      profileId,
    }
    activeRequestRef.current = request.requestId
    setResultMode(conditions.mode)
    setResults([])
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
      if (!window.confirm('搜索仍在进行。取消搜索并关闭窗口吗？')) return
      cancelSearch()
    }
    onClose()
  }
  requestCloseRef.current = requestClose

  const selectResult = (result: RemoteSearchResult) => {
    if (running) {
      if (!window.confirm('搜索仍在进行。取消搜索并打开此结果吗？')) return
      cancelSearch()
    }
    onSelectResult(result)
  }

  const replayHistory = (savedConditions: SearchConditions) => {
    setConditions({ ...savedConditions })
    setResultMode(savedConditions.mode)
    setResults([])
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
            <div className="modal-kicker"><Search size={14} /> 远端搜索</div>
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

            <div className="search-results-list" aria-live="polite">
              {results.map((result) => (
                <button className="search-result" key={result.path} onClick={() => selectResult(result)} title={'在文件浏览器中定位 ' + result.path}>
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
    </div>
  )
}
