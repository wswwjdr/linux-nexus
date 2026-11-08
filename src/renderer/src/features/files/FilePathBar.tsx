import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { ArrowUp, Check, ChevronRight, House, LayoutGrid, List, LoaderCircle, Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { FileViewMode } from '@/app-types'
import { getParentPath } from '@/app-utils'

export interface Breadcrumb {
  label: string
  path: string
}

interface FilePathBarProps {
  currentPath: string
  breadcrumbs: Breadcrumb[]
  viewMode: FileViewMode
  entryCount: number
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => Promise<boolean>
}

export default function FilePathBar({
  currentPath,
  breadcrumbs,
  viewMode,
  entryCount,
  onViewModeChange,
  onNavigate,
}: FilePathBarProps) {
  useLanguage()
  const pathInputRef = useRef<HTMLInputElement>(null)
  const pathEditFormRef = useRef<HTMLFormElement>(null)
  const [pathEditing, setPathEditing] = useState(false)
  const [pathDraft, setPathDraft] = useState(currentPath)
  const [pathSubmitting, setPathSubmitting] = useState(false)

  useEffect(() => {
    setPathDraft(currentPath)
    setPathEditing(false)
  }, [currentPath])

  useEffect(() => {
    if (!pathEditing) return
    pathInputRef.current?.focus()
    pathInputRef.current?.select()
  }, [pathEditing])

  useEffect(() => {
    if (!pathEditing) return
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !pathEditFormRef.current?.contains(event.target)) {
        setPathDraft(currentPath)
        setPathEditing(false)
      }
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    return () => document.removeEventListener('pointerdown', dismissOutside, true)
  }, [currentPath, pathEditing])

  const cancelPathEdit = () => {
    setPathDraft(currentPath)
    setPathEditing(false)
  }

  const submitPathEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pathSubmitting) return
    setPathSubmitting(true)
    try {
      if (await onNavigate(pathDraft)) setPathEditing(false)
    } finally {
      setPathSubmitting(false)
    }
  }

  return (
    <div className="pathbar">
      <button className="icon-button path-nav" title={tr('files.goToRootDirectory')} aria-label={tr('files.goToRootDirectory')} disabled={currentPath === '/'} onClick={() => void onNavigate('/')}>
        <House size={16} />
      </button>
      <button className="icon-button path-nav nav-group-end" title={tr('files.goToParentDirectory')} aria-label={tr('files.goToParentDirectory')} disabled={currentPath === '/'} onClick={() => void onNavigate(getParentPath(currentPath))}>
        <ArrowUp size={16} />
      </button>
      {pathEditing ? (
        <form ref={pathEditFormRef} className="path-edit-form" onSubmit={(event) => void submitPathEdit(event)}>
          <input
            ref={pathInputRef}
            className="path-edit-input"
            aria-label={tr('common.remotePath')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={pathDraft}
            disabled={pathSubmitting}
            onChange={(event) => setPathDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelPathEdit()
              }
            }}
          />
          <button className="icon-button path-nav" type="submit" title={tr('files.goToPath')} aria-label={tr('files.goToPath')} disabled={pathSubmitting}>
            {pathSubmitting ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />}
          </button>
          <button className="icon-button path-nav" type="button" title={tr('files.cancelEditing')} aria-label={tr('files.cancelEditing')} disabled={pathSubmitting} onClick={cancelPathEdit}>
            <X size={16} />
          </button>
        </form>
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
              setPathDraft(currentPath)
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
