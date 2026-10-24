import { Clock3, Trash2 } from 'lucide-react'
import type { SearchScope } from '@shared/types'

export interface SearchScopeConditions {
  scope: SearchScope
  rootPath: string
}

interface SearchScopeControlProps extends SearchScopeConditions {
  currentPath: string
  disabled: boolean
  onScopeChange: (scope: SearchScope, rootPath: string) => void
  onRootPathChange: (rootPath: string) => void
}

export function isNormalizedAbsoluteRemotePath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('\0') || path.includes('\n') || path.includes('\r')) return false
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length) segments.pop()
    } else segments.push(segment)
  }
  return '/' + segments.join('/') === path
}

export function SearchScopeControl({ scope, rootPath, currentPath, disabled, onScopeChange, onRootPathChange }: SearchScopeControlProps) {
  const validCustomPath = scope !== 'custom' || isNormalizedAbsoluteRemotePath(rootPath)
  return (
    <fieldset className="settings-view-field search-option-field">
      <legend>搜索范围</legend>
      <div className="settings-view-options search-scope-options">
        <button type="button" className="settings-view-option" disabled={disabled} aria-pressed={scope === 'current'} onClick={() => onScopeChange('current', currentPath)}>当前目录</button>
        <button type="button" className="settings-view-option" disabled={disabled} aria-pressed={scope === 'root'} onClick={() => onScopeChange('root', '/')}>系统根目录</button>
        <button type="button" className="settings-view-option" disabled={disabled} aria-pressed={scope === 'custom'} onClick={() => onScopeChange('custom', scope === 'custom' ? rootPath : currentPath)}>自定义</button>
      </div>
      {scope === 'custom' ? (
        <label className="field search-custom-path-field">
          远端绝对路径
          <input
            type="text"
            value={rootPath}
            disabled={disabled}
            maxLength={4096}
            onChange={(event) => onRootPathChange(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {!validCustomPath && <span className="search-field-error">请输入规范化的绝对路径</span>}
        </label>
      ) : (
        <div className="search-scope-path" title={rootPath}>{rootPath}</div>
      )}
    </fieldset>
  )
}

export function isHistoryArray<T>(value: unknown, validate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(validate)
}

export function readSearchHistory<T>(key: string, validate: (item: unknown) => item is T): T[] {
  const saved = window.localStorage.getItem(key)
  if (!saved) return []
  try {
    const parsed: unknown = JSON.parse(saved)
    return isHistoryArray(parsed, validate) ? parsed.slice(0, 10) : []
  } catch {
    return []
  }
}

export function SearchHistory<T>({
  history,
  disabled,
  label,
  onClear,
  onSelect,
}: {
  history: T[]
  disabled: boolean
  label: (item: T) => { query: string; detail: string }
  onClear: () => void
  onSelect: (item: T) => void
}) {
  return (
    <section className="search-history" aria-label="最近搜索">
      <div className="search-history-heading">
        <h3><Clock3 size={14} /> 最近搜索</h3>
        {history.length > 0 && <button className="icon-button subtle" type="button" disabled={disabled} title="清空搜索历史" aria-label="清空搜索历史" onClick={onClear}><Trash2 size={14} /></button>}
      </div>
      {history.length ? (
        <div className="search-history-list">
          {history.map((item, index) => {
            const itemLabel = label(item)
            return (
              <button className="search-history-item" type="button" disabled={disabled} key={itemLabel.query + ':' + index} onClick={() => onSelect(item)}>
                <span className="search-history-query">{itemLabel.query}</span>
                <span className="search-history-meta">{itemLabel.detail}</span>
              </button>
            )
          })}
        </div>
      ) : <p className="search-history-empty">暂无搜索历史</p>}
    </section>
  )
}
