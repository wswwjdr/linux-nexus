import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useImperativeHandle, useLayoutEffect, useRef, type KeyboardEvent, type Ref, type RefObject } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import type { LogPreviewDialog } from '@/app-types'
import PreviewSearchBar from './PreviewSearchBar'
import { usePreviewSearch, type PreviewSearchHandle } from './usePreviewSearch'

interface LogPreviewPanelProps {
  ref?: Ref<PreviewSearchHandle>
  dialog: Extract<LogPreviewDialog, { kind: 'ready' }>
  viewportRef: RefObject<HTMLPreElement | null>
  onScroll: () => void
}

export default function LogPreviewPanel({ ref, dialog, viewportRef, onScroll }: LogPreviewPanelProps) {
  useLanguage()
  const { content } = dialog
  const search = usePreviewSearch(content, true)
  const markerRef = useRef<HTMLElement>(null)
  const { matchStart, matchEnd, revealRequest } = search

  useLayoutEffect(() => {
    if (matchStart === undefined) return
    const viewport = viewportRef.current!
    const marker = markerRef.current!.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    viewport.scrollTop += marker.top - bounds.top - (viewport.clientHeight - marker.height) / 2
    // Only user search commands reveal a match; prepending pages preserves the reading position.
  }, [revealRequest])

  const openSearch = () => {
    const selection = window.getSelection()
    let selected = ''
    let start = content.length
    if (selection && selection.rangeCount && viewportRef.current!.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      const range = selection.getRangeAt(0)
      const prefix = range.cloneRange()
      prefix.selectNodeContents(viewportRef.current!)
      prefix.setEnd(range.startContainer, range.startOffset)
      start = prefix.toString().length
      selected = selection.toString()
    }
    search.openSearch(selected, start)
  }
  const closeSearch = () => {
    if (!search.closeSearch()) return false
    viewportRef.current!.focus({ preventScroll: true })
    return true
  }
  useImperativeHandle(ref, () => ({ openSearch, closeSearch }))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      openSearch()
    } else if (search.searchOpen && (event.key === 'F3' || (event.key === 'Enter' && event.target === search.searchRef.current))) {
      event.preventDefault()
      event.stopPropagation()
      search.navigate(event.shiftKey ? -1 : 1)
    } else if (search.searchOpen && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeSearch()
    }
  }

  return (
    <div className="text-preview-content" onKeyDown={onKeyDown}>
      <PreviewSearchBar search={search} onClose={closeSearch} />
      <div className="log-preview-status" aria-live="polite">
        {dialog.loadingEarlier
          ? <><LoaderCircle className="spin" size={14} />{tr('previews.readingEarlierContent')}</>
          : !dialog.hasEarlier
            ? dialog.startOffset === 0 ? tr('previews.startOfFileReached') : tr('errors.textPreviewLimitReached')
            : ''}
      </div>
      <pre ref={viewportRef} className="preview-text log-preview-text" tabIndex={0} onScroll={onScroll}>
        {matchStart === undefined ? content : <>{content.slice(0, matchStart)}<mark ref={markerRef}>{content.slice(matchStart, matchEnd)}</mark>{content.slice(matchEnd)}</>}
      </pre>
      <div className="text-preview-footer">
        <span className="text-preview-status">{tr('previews.searchScopeLoadedContent')}{dialog.hasEarlier ? tr('previews.scrollUpToLoadEarlierLogEntries') : ''}</span>
        <button type="button" className="icon-button text-preview-find" title={tr('previews.findTextCtrlF')} aria-label={tr('previews.findTextCtrlF')} onClick={openSearch}><Search size={16} /></button>
      </div>
    </div>
  )
}
