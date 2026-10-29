import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { PreviewSearch } from './usePreviewSearch'

interface PreviewSearchBarProps {
  search: PreviewSearch
  disabled?: boolean
  onClose: () => void
}

export default function PreviewSearchBar({ search, disabled = false, onClose }: PreviewSearchBarProps) {
  if (!search.searchOpen) return null
  return (
    <div className="text-preview-search" role="search" aria-label="文本内搜索">
      <Search size={15} aria-hidden="true" />
      <input ref={search.searchRef} aria-label="搜索文本" placeholder="搜索文本" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        disabled={disabled} value={search.query} onChange={(event) => search.updateQuery(event.target.value)} />
      <span className="text-preview-search-count" role="status">
        {!search.query ? '' : search.matches.length ? `${search.matchIndex + 1} / ${search.matches.length}` : '无匹配'}
      </span>
      <button type="button" className="icon-button" title="区分大小写" aria-label="区分大小写" aria-pressed={search.caseSensitive} disabled={disabled} onClick={search.toggleCase}><CaseSensitive size={17} /></button>
      <button type="button" className="icon-button" title="上一处（Shift+Enter）" aria-label="上一处" disabled={disabled || !search.matches.length} onClick={() => search.navigate(-1)}><ChevronUp size={16} /></button>
      <button type="button" className="icon-button" title="下一处（Enter）" aria-label="下一处" disabled={disabled || !search.matches.length} onClick={() => search.navigate(1)}><ChevronDown size={16} /></button>
      <button type="button" className="icon-button" title="关闭文本搜索（Esc）" aria-label="关闭文本搜索" disabled={disabled} onClick={onClose}><X size={15} /></button>
    </div>
  )
}
