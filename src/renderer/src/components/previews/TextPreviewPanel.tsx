import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useCallback, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import { LoaderCircle, Save, Search } from 'lucide-react'
import PreviewSearchBar from './PreviewSearchBar'
import { usePreviewSearch, type PreviewSearchHandle } from './usePreviewSearch'

interface TextPreviewPanelProps {
  ref?: Ref<PreviewSearchHandle>
  draft: string
  dirty: boolean
  saving: boolean
  saveConfirmationOpen: boolean
  onUpdateDraft: (content: string) => void
  onRequestSave: () => void
}

const LINE_HEIGHT = 20
const LINE_NUMBER_OVERSCAN = 3

/**
 * Renders the editable text preview with line numbers and in-file search.
 * @param props Current draft and save state, edit and save callbacks, and an optional search handle ref.
 * @returns The text editor, search controls, and save footer.
 */
export default function TextPreviewPanel({
  ref,
  draft,
  dirty,
  saving,
  saveConfirmationOpen,
  onUpdateDraft,
  onRequestSave,
}: TextPreviewPanelProps) {
  useLanguage()
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const matchRef = useRef<HTMLElement>(null)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const disabled = saving || saveConfirmationOpen
  // Search the textarea's normalized value so CRLF/CR offsets match its selection API.
  const content = useMemo(() => draft.replace(/\r\n|\r/g, '\n'), [draft])
  const lineCount = useMemo(() => {
    let count = 1
    for (let index = content.indexOf('\n'); index !== -1; index = content.indexOf('\n', index + 1)) count++
    return count
  }, [content])
  const firstLine = Math.min(lineCount, Math.max(0, Math.floor(viewport.top / LINE_HEIGHT) - LINE_NUMBER_OVERSCAN))
  const endLine = Math.min(lineCount, Math.ceil((viewport.top + viewport.height) / LINE_HEIGHT) + LINE_NUMBER_OVERSCAN)
  const search = usePreviewSearch(content)
  const { searchOpen, searchRef, matchStart, matchEnd, revealRequest, navigate } = search

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
    if (matchStart === undefined || disabled) return
    const editor = editorRef.current!
    const marker = matchRef.current!
    editor.setSelectionRange(matchStart, matchEnd!)
    editor.scrollTop = marker.offsetTop - (editor.clientHeight - marker.offsetHeight) / 2
    editor.scrollLeft = Math.max(0, marker.offsetLeft - editor.clientWidth / 2)
    syncScroll()
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
      <div className="text-preview-footer">
        <span className={dirty ? 'text-preview-status modified' : 'text-preview-status'} aria-live="polite">
          {saving ? tr('previews.saving') : dirty ? tr('previews.unsavedChanges') : tr('connections.saved')}
        </span>
        <button type="button" className="icon-button text-preview-find" title={tr('previews.findTextCtrlF')} aria-label={tr('previews.findTextCtrlF')} disabled={disabled} onClick={openSearch}><Search size={16} /></button>
        <button type="button" className="primary-button text-preview-save" disabled={!dirty || saving || saveConfirmationOpen} onClick={onRequestSave}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {saving ? tr('previews.saving2') : tr('previews.save')}
        </button>
      </div>
    </div>
  )
}
