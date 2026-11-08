import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import type { PreviewSearch } from './usePreviewSearch'

interface PreviewSearchBarProps {
  search: PreviewSearch
  disabled?: boolean
  onClose: () => void
}

export default function PreviewSearchBar({ search, disabled = false, onClose }: PreviewSearchBarProps) {
  useLanguage()
  if (!search.searchOpen) return null
  return (
    <div className="text-preview-search" role="search" aria-label={tr('search.findInText')}>
      <Search size={15} aria-hidden="true" />
      <input ref={search.searchRef} aria-label={tr('search.findText')} placeholder={tr('search.findText')} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        disabled={disabled} value={search.query} onChange={(event) => search.updateQuery(event.target.value)} />
      <span className="text-preview-search-count" role="status">
        {!search.query ? '' : search.matches.length ? `${search.matchIndex + 1} / ${search.matches.length}` : tr('search.noMatches')}
      </span>
      <button type="button" className="icon-button" title={tr('search.caseSensitive')} aria-label={tr('search.caseSensitive')} aria-pressed={search.caseSensitive} disabled={disabled} onClick={search.toggleCase}><CaseSensitive size={17} /></button>
      <button type="button" className="icon-button" title={tr('search.previousMatchShiftEnter')} aria-label={tr('search.previousMatch')} disabled={disabled || !search.matches.length} onClick={() => search.navigate(-1)}><ChevronUp size={16} /></button>
      <button type="button" className="icon-button" title={tr('search.nextMatchEnter')} aria-label={tr('search.nextMatch')} disabled={disabled || !search.matches.length} onClick={() => search.navigate(1)}><ChevronDown size={16} /></button>
      <button type="button" className="icon-button" title={tr('search.closeTextSearchEsc')} aria-label={tr('search.closeTextSearch')} disabled={disabled} onClick={onClose}><X size={15} /></button>
    </div>
  )
}
