import { useLanguage } from '@/i18n'
import { renderMessage, tr } from '@shared/i18n/messages'
import { ArrowUp, Check, ChevronRight, Folder, House, LayoutGrid, List, LoaderCircle, Pencil, X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import type { FileIdentity } from '@shared/types'
import type { FileViewMode } from '@/app-types'
import { getParentPath } from '@/app-utils'
import { usePathCompletion } from './usePathCompletion'

export interface Breadcrumb {
  label: string
  path: string
}

interface FilePathBarProps {
  sessionId: string
  fileIdentity: FileIdentity | undefined
  currentPath: string
  breadcrumbs: Breadcrumb[]
  viewMode: FileViewMode
  entryCount: number
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => Promise<boolean>
}

function PathEditor({ sessionId, currentPath, onNavigate, onClose }: Pick<FilePathBarProps, 'sessionId' | 'currentPath' | 'onNavigate'> & { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const mounted = useRef(false)
  const listId = useId()
  const completion = usePathCompletion(sessionId, currentPath)
  const { draft, query, suggestions, activeIndex, completionCaret } = completion
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    mounted.current = true
    inputRef.current?.focus()
    inputRef.current?.select()
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    if (!completionCaret) return
    inputRef.current?.focus()
    inputRef.current?.setSelectionRange(completionCaret.position, completionCaret.position)
  }, [completionCaret])

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !formRef.current?.contains(event.target)) onClose()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => document.removeEventListener('pointerdown', dismissOutside, true)
  }, [onClose])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return
    completion.dismiss()
    setSubmitting(true)
    try {
      if (await onNavigate(draft) && mounted.current) onClose()
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  return (
    <form ref={formRef} className="path-edit-form" onSubmit={(event) => void submit(event)}>
      <div className="path-completion-anchor">
        <input
          ref={inputRef}
          className="path-edit-input"
          role="combobox"
          aria-label={tr('common.remotePath')}
          aria-autocomplete="list"
          aria-expanded={query !== null}
          aria-controls={query ? listId : undefined}
          aria-activedescendant={query && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={draft}
          disabled={submitting}
          onChange={(event) => completion.changeDraft(event.target.value, event.target.selectionStart ?? event.target.value.length)}
          onSelect={(event) => completion.moveCaret(event.currentTarget.selectionStart ?? draft.length)}
          onBlur={(event) => {
            if (!(event.relatedTarget instanceof Node) || !formRef.current?.contains(event.relatedTarget)) completion.dismiss()
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (query) completion.dismiss()
              else onClose()
            } else if (query && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault()
              completion.moveSelection(event.key === 'ArrowDown' ? 1 : -1)
            } else if (query && ((event.key === 'Enter' && activeIndex >= 0) || (event.key === 'Tab' && !event.shiftKey && suggestions.length > 0))) {
              event.preventDefault()
              completion.accept(suggestions[activeIndex >= 0 ? activeIndex : 0])
            }
          }}
        />
        {query && (
          <div className="path-completion-popup">
            <div ref={listRef} id={listId} role="listbox" aria-label={tr('files.directorySuggestions')} aria-busy={query.status === 'loading'} className="path-completion-list">
              {suggestions.map((entry, index) => (
                <div
                  key={entry.path}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={activeIndex === index}
                  className="path-completion-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => completion.accept(entry)}
                >
                  <Folder size={15} /><span>{entry.name}/</span>
                </div>
              ))}
            </div>
            {query.status === 'loading' && <div className="path-completion-status" role="status"><LoaderCircle className="spin" size={14} />{tr('files.readingDirectory2')}</div>}
            {query.status === 'error' && <div className="path-completion-status error" role="status">{tr('files.directorySuggestionsFailed', { error: renderMessage(query.error) })}</div>}
            {query.status === 'ready' && suggestions.length === 0 && <div className="path-completion-status" role="status">{tr('files.noMatchingDirectories')}</div>}
          </div>
        )}
      </div>
      <button className="icon-button path-nav" type="submit" title={tr('files.goToPath')} aria-label={tr('files.goToPath')} disabled={submitting}>
        {submitting ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />}
      </button>
      <button className="icon-button path-nav" type="button" title={tr('files.cancelEditing')} aria-label={tr('files.cancelEditing')} disabled={submitting} onClick={onClose}>
        <X size={16} />
      </button>
    </form>
  )
}

export default function FilePathBar(props: FilePathBarProps) {
  return <FilePathBarContent key={JSON.stringify([props.sessionId, props.fileIdentity, props.currentPath])} {...props} />
}

function FilePathBarContent({
  sessionId,
  currentPath,
  breadcrumbs,
  viewMode,
  entryCount,
  onViewModeChange,
  onNavigate,
}: FilePathBarProps) {
  useLanguage()
  const [pathEditing, setPathEditing] = useState(false)
  const closeEditor = useCallback(() => setPathEditing(false), [])

  return (
    <div className="pathbar">
      <button className="icon-button path-nav" title={tr('files.goToRootDirectory')} aria-label={tr('files.goToRootDirectory')} disabled={currentPath === '/'} onClick={() => void onNavigate('/')}>
        <House size={16} />
      </button>
      <button className="icon-button path-nav nav-group-end" title={tr('files.goToParentDirectory')} aria-label={tr('files.goToParentDirectory')} disabled={currentPath === '/'} onClick={() => void onNavigate(getParentPath(currentPath))}>
        <ArrowUp size={16} />
      </button>
      {pathEditing ? (
        <PathEditor sessionId={sessionId} currentPath={currentPath} onNavigate={onNavigate} onClose={closeEditor} />
      ) : (
        <>
          <nav className="breadcrumbs" aria-label={tr('files.currentPath')}>
            {breadcrumbs.map((crumb, index) => (
              <span className="breadcrumb-piece" key={crumb.path}>
                {index > 0 && <ChevronRight size={13} />}
                <button className={index === breadcrumbs.length - 1 ? 'current-crumb' : ''} onClick={() => void onNavigate(crumb.path)}>{crumb.label}</button>
              </span>
            ))}
          </nav>
          <button
            className="icon-button path-nav path-edit-button"
            type="button"
            title={tr('files.editPath')}
            aria-label={tr('files.editPath')}
            onClick={() => {
              setPathEditing(true)
            }}
          >
            <Pencil size={15} />
          </button>
        </>
      )}
      <div className="pathbar-tools">
        <div className="view-toggle" role="group" aria-label={tr('files.fileView')}>
          <button className="view-toggle-button" title={tr('settings.iconView')} aria-label={tr('settings.iconView')} aria-pressed={viewMode === 'icons'} onClick={() => onViewModeChange('icons')}>
            <LayoutGrid size={16} />
          </button>
          <button className="view-toggle-button" title={tr('files.detailsView')} aria-label={tr('files.detailsView')} aria-pressed={viewMode === 'details'} onClick={() => onViewModeChange('details')}>
            <List size={17} />
          </button>
        </div>
        <div className="path-count">{tr('files.entryCount', { count: entryCount })}</div>
      </div>
    </div>
  )
}
