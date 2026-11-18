import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { LoaderCircle, Save, Search } from 'lucide-react'
import PreviewSearchBar from './PreviewSearchBar'
import { usePreviewSearch, type PreviewSearchHandle } from './usePreviewSearch'

interface TextPreviewPanelProps {
  ref?: Ref<PreviewSearchHandle>
  encodingControls?: ReactNode
  reloading?: boolean
  draft: string
  dirty: boolean
  saving: boolean
  conflictOpen: boolean
  lossy: boolean
  onUpdateDraft: (content: string) => void
  onRequestSave: () => void
}

const LINE_HEIGHT = 23
const LINE_NUMBER_OVERSCAN = 3

/**
 * Renders the editable text preview with line numbers and in-file search.
 * @param props Current draft and save state, edit and save callbacks, and an optional search handle ref.
 * @returns The text editor, search and save controls, and position and encoding bar.
 */
export default function TextPreviewPanel({
  ref,
  encodingControls,
  reloading = false,
  draft,
  dirty,
  saving,
  conflictOpen,
  lossy,
  onUpdateDraft,
  onRequestSave,
}: TextPreviewPanelProps) {
  useLanguage()
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const matchRef = useRef<HTMLElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const disabled = saving || reloading || conflictOpen
  // Search the textarea's normalized value so CRLF/CR offsets match its selection API.
  const content = useMemo(() => draft.replace(/\r\n|\r/g, '\n'), [draft])
  const lineStarts = useMemo(() => {
    const starts = [0]
    for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) starts.push(index + 1)
    return starts
  }, [content])
  const lineCount = lineStarts.length
  const firstLine = Math.min(lineCount, Math.max(0, Math.floor(viewport.top / LINE_HEIGHT) - LINE_NUMBER_OVERSCAN))
  const endLine = Math.min(lineCount, Math.ceil((viewport.top + viewport.height) / LINE_HEIGHT) + LINE_NUMBER_OVERSCAN)
  const search = usePreviewSearch(content)
  const { searchOpen, searchRef, matchStart, matchEnd, revealRequest, navigate } = search

  /** Updates the one-based line and column at the active end of the editor selection. */
  const syncCursor = useCallback(() => {
    const editor = editorRef.current!
    const offset = editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd
    // Find the last line start at or before the caret without scanning preceding lines.
    let start = 0
    let end = lineStarts.length
    while (end - start > 1) {
      const middle = Math.floor((start + end) / 2)
      if (lineStarts[middle] <= offset) start = middle
      else end = middle
    }
    const line = start + 1
    const column = offset - lineStarts[start] + 1
    setCursor((previous) => previous.line === line && previous.column === column ? previous : { line, column })
  }, [lineStarts])

  /** Aligns the search highlight and updates the visible line-number range from the editor viewport. */
  const syncScroll = useCallback(() => {
    const editor = editorRef.current!
    const highlight = highlightRef.current!
    const top = editor.scrollTop
    const height = editor.clientHeight
    // The hidden mirror has no horizontal scrollbar, so reserve its height at the bottom.
    highlight.style.setProperty('--text-preview-scrollbar-height', `${Math.max(0, highlight.clientHeight - height)}px`)
    highlight.scrollTop = top
    highlight.scrollLeft = editor.scrollLeft
    setViewport((previous) => previous.top === top && previous.height === height ? previous : { top, height })
  }, [])

  useLayoutEffect(() => {
    const observer = new ResizeObserver(syncScroll)
    observer.observe(editorRef.current!)
    return () => observer.disconnect()
  }, [syncScroll])

  // Shortening the draft can clamp the editor's scroll position during layout.
  useLayoutEffect(syncScroll, [content, syncScroll])
  useLayoutEffect(() => {
    const editor = editorRef.current!
    syncCursor()
    editor.addEventListener('selectionchange', syncCursor)
    return () => editor.removeEventListener('selectionchange', syncCursor)
  }, [syncCursor])

  useLayoutEffect(() => {
    if (matchStart === undefined || disabled) return
    const editor = editorRef.current!
    const marker = matchRef.current!
    editor.setSelectionRange(matchStart, matchEnd!)
    editor.scrollTop = marker.offsetTop - (editor.clientHeight - marker.offsetHeight) / 2
    editor.scrollLeft = Math.max(0, marker.offsetLeft - editor.clientWidth / 2)
    syncScroll()
    syncCursor()
    // Editing recomputes matches but must not move the user's caret or viewport.
  }, [revealRequest])

  const openSearch = () => {
    const editor = editorRef.current!
    search.openSearch(editor.value.slice(editor.selectionStart, editor.selectionEnd), editor.selectionStart)
  }

  const closeSearch = () => {
    if (!search.closeSearch()) return false
    editorRef.current!.focus({ preventScroll: true })
    return true
  }

  useImperativeHandle(ref, () => ({ openSearch, closeSearch }))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return
    const command = event.ctrlKey || event.metaKey
    if (command && event.key.toLowerCase() === 'f') {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled) openSearch()
    } else if (command && event.key.toLowerCase() === 's') {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled) onRequestSave()
    } else if (searchOpen && (event.key === 'F3' || (event.key === 'Enter' && event.target === searchRef.current))) {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled) navigate(event.shiftKey ? -1 : 1)
    } else if (searchOpen && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (!disabled) closeSearch()
    }
  }

  return (
    <div className="text-preview-content" onKeyDown={onKeyDown}>
      <div className="text-preview-actions">
        <span className={dirty ? 'text-preview-status modified' : 'text-preview-status'} aria-live="polite">
          {reloading ? tr('previews.readingFile') : saving ? tr('previews.saving') : dirty ? tr('previews.unsavedChanges') : tr('connections.saved')}
        </span>
        <button type="button" className="text-preview-find text-preview-tool" title={tr('previews.findTextCtrlF')} aria-label={tr('previews.findTextCtrlF')} disabled={disabled} onClick={openSearch}><Search size={15} />{tr('search.search')}</button>
        <button type="button" className="primary-button text-preview-save" disabled={!dirty || disabled} onClick={onRequestSave}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {saving ? tr('previews.saving2') : tr('previews.save')}
        </button>
      </div>
      <PreviewSearchBar search={search} disabled={disabled} onClose={closeSearch} />
      <div className="text-preview-surface" style={{ '--text-preview-line-height': `${LINE_HEIGHT}px` } as CSSProperties}>
        <div className="text-preview-gutter" aria-hidden="true" style={{ width: `calc(${String(lineCount).length}ch + 24px)` }}>
          <div className="text-preview-gutter-viewport" style={{ height: viewport.height }}>
            <div className="text-preview-line-numbers" style={{ transform: `translateY(${firstLine * LINE_HEIGHT - viewport.top}px)` }}>
              {Array.from({ length: endLine - firstLine }, (_, index) => {
                const number = firstLine + index + 1
                return <div key={number}>{number}</div>
              })}
            </div>
          </div>
        </div>
        <div className="text-preview-editor-stack">
          <pre ref={highlightRef} className="preview-text text-preview-highlight" aria-hidden="true">
            {matchStart === undefined ? content : <>{content.slice(0, matchStart)}<mark ref={matchRef}>{content.slice(matchStart, matchEnd)}</mark>{content.slice(matchEnd)}</>}{'\n'}
          </pre>
          <textarea
            ref={editorRef}
            className="preview-text text-preview-editor"
            aria-label={tr('previews.textContent')}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            disabled={disabled}
            spellCheck={false}
            wrap="off"
            value={draft}
            onChange={(event) => onUpdateDraft(event.target.value)}
            onScroll={syncScroll}
          />
        </div>
      </div>
      {lossy && <div className="text-preview-encoding-warning" role="status">{tr('previews.textDecodedWithReplacement')}</div>}
      <div className="text-preview-footer text-preview-info">
        <span className="text-preview-position">{tr('previews.textCursorPosition', cursor)}</span>
        {encodingControls}
      </div>
    </div>
  )
}
