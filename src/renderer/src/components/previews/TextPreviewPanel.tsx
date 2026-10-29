import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, LoaderCircle, Save, Search, X } from 'lucide-react'
import { findTextMatches } from './text-search'

interface TextPreviewPanelProps {
  ref?: Ref<TextPreviewPanelHandle>
  draft: string
  dirty: boolean
  saving: boolean
  saveConfirmationOpen: boolean
  onUpdateDraft: (content: string) => void
  onRequestSave: () => void
}

export interface TextPreviewPanelHandle {
  openSearch: () => void
  closeSearch: () => boolean
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
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [matchAnchor, setMatchAnchor] = useState(0)
  const [revealRequest, setRevealRequest] = useState(0)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const matchRef = useRef<HTMLElement>(null)
  const disabled = saving || saveConfirmationOpen
  // Search the textarea's normalized value so CRLF/CR offsets match its selection API.
  const content = useMemo(() => draft.replace(/\r\n|\r/g, '\n'), [draft])
  const matches = useMemo(() => searchOpen ? findTextMatches(content, query, caseSensitive) : [], [content, query, caseSensitive, searchOpen])
  const foundIndex = matches.findIndex((offset) => offset >= matchAnchor)
  const matchIndex = matches.length ? foundIndex === -1 ? matches.length - 1 : foundIndex : -1
  const matchStart = matches[matchIndex]
  const matchEnd = matchStart === undefined ? undefined : matchStart + query.length

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
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd)
    if (selected && !selected.includes('\n')) setQuery(selected)
    setMatchAnchor(editor.selectionStart)
    setSearchOpen(true)
    setRevealRequest((value) => value + 1)
    // The input mounts after this event; the layout effect focuses it on first open.
    searchRef.current?.focus()
    searchRef.current?.select()
  }

  useLayoutEffect(() => {
    if (searchOpen) {
      searchRef.current!.focus()
      searchRef.current!.select()
    }
  }, [searchOpen])

  const closeSearch = () => {
    if (!searchOpen) return false
    setSearchOpen(false)
    editorRef.current!.focus({ preventScroll: true })
    return true
  }

  useImperativeHandle(ref, () => ({ openSearch, closeSearch }))

  const navigate = (direction: number) => {
    if (!matches.length) return
    setMatchAnchor(matches[(matchIndex + direction + matches.length) % matches.length])
    setRevealRequest((value) => value + 1)
  }

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
      {searchOpen && (
        <div className="text-preview-search" role="search" aria-label="文本内搜索">
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="搜索文本"
            placeholder="搜索文本"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={disabled}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setMatchAnchor(0); setRevealRequest((value) => value + 1) }}
          />
          <span className="text-preview-search-count" role="status">
            {!query ? '' : matches.length ? `${matchIndex + 1} / ${matches.length}` : '无匹配'}
          </span>
          <button type="button" className="icon-button" title="区分大小写" aria-label="区分大小写" aria-pressed={caseSensitive} disabled={disabled} onClick={() => { setCaseSensitive(!caseSensitive); setMatchAnchor(0); setRevealRequest((value) => value + 1) }}><CaseSensitive size={17} /></button>
          <button type="button" className="icon-button" title="上一处（Shift+Enter）" aria-label="上一处" disabled={disabled || !matches.length} onClick={() => navigate(-1)}><ChevronUp size={16} /></button>
          <button type="button" className="icon-button" title="下一处（Enter）" aria-label="下一处" disabled={disabled || !matches.length} onClick={() => navigate(1)}><ChevronDown size={16} /></button>
          <button type="button" className="icon-button" title="关闭文本搜索（Esc）" aria-label="关闭文本搜索" disabled={disabled} onClick={closeSearch}><X size={15} /></button>
        </div>
      )}
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
