import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type Ref } from 'react'
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

export default function TextPreviewPanel({
  ref,
  draft,
  dirty,
  saving,
  saveConfirmationOpen,
  onUpdateDraft,
  onRequestSave,
}: TextPreviewPanelProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const matchRef = useRef<HTMLElement>(null)
  const disabled = saving || saveConfirmationOpen
  // Search the textarea's normalized value so CRLF/CR offsets match its selection API.
  const content = useMemo(() => draft.replace(/\r\n|\r/g, '\n'), [draft])
  const search = usePreviewSearch(content)
  const { searchOpen, searchRef, matchStart, matchEnd, revealRequest, navigate } = search

  const syncScroll = () => {
    const editor = editorRef.current!
    const highlight = highlightRef.current!
    highlight.scrollTop = editor.scrollTop
    highlight.scrollLeft = editor.scrollLeft
  }

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
      <div className="text-preview-surface">
        <pre ref={highlightRef} className="preview-text text-preview-highlight" aria-hidden="true">
          {matchStart === undefined ? content : <>{content.slice(0, matchStart)}<mark ref={matchRef}>{content.slice(matchStart, matchEnd)}</mark>{content.slice(matchEnd)}</>}{'\n'}
        </pre>
        <textarea
          ref={editorRef}
          className="preview-text text-preview-editor"
          aria-label="文本内容"
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
      <div className="text-preview-footer">
        <span className={dirty ? 'text-preview-status modified' : 'text-preview-status'} aria-live="polite">
          {saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
        </span>
        <button type="button" className="icon-button text-preview-find" title="搜索文本（Ctrl+F）" aria-label="搜索文本（Ctrl+F）" disabled={disabled} onClick={openSearch}><Search size={16} /></button>
        <button type="button" className="primary-button text-preview-save" disabled={!dirty || saving || saveConfirmationOpen} onClick={onRequestSave}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {saving ? '保存中' : '保存'}
        </button>
      </div>
    </div>
  )
}
