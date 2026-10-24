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
      <button className="icon-button path-nav" title="返回根目录" aria-label="返回根目录" disabled={currentPath === '/'} onClick={() => void onNavigate('/')}>
        <House size={16} />
      </button>
      <button className="icon-button path-nav nav-group-end" title="返回上级目录" aria-label="返回上级目录" disabled={currentPath === '/'} onClick={() => void onNavigate(getParentPath(currentPath))}>
        <ArrowUp size={16} />
      </button>
      {pathEditing ? (
        <form ref={pathEditFormRef} className="path-edit-form" onSubmit={(event) => void submitPathEdit(event)}>
          <input
            ref={pathInputRef}
            className="path-edit-input"
            aria-label="远程路径"
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
          <button className="icon-button path-nav" type="submit" title="跳转到路径" aria-label="跳转到路径" disabled={pathSubmitting}>
            {pathSubmitting ? <LoaderCircle className="spin" size={15} /> : <Check size={16} />}
          </button>
          <button className="icon-button path-nav" type="button" title="取消编辑" aria-label="取消编辑" disabled={pathSubmitting} onClick={cancelPathEdit}>
            <X size={16} />
          </button>
        </form>
      ) : (
        <>
          <nav className="breadcrumbs" aria-label="当前路径">
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
            title="编辑路径"
            aria-label="编辑路径"
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
        <div className="view-toggle" role="group" aria-label="文件视图">
          <button className="view-toggle-button" title="图标视图" aria-label="图标视图" aria-pressed={viewMode === 'icons'} onClick={() => onViewModeChange('icons')}>
            <LayoutGrid size={16} />
          </button>
          <button className="view-toggle-button" title="详细信息视图" aria-label="详细信息视图" aria-pressed={viewMode === 'details'} onClick={() => onViewModeChange('details')}>
            <List size={17} />
          </button>
        </div>
        <div className="path-count">{entryCount} 项</div>
      </div>
    </div>
  )
}
