import {
  Folder,
  LoaderCircle,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { DroppedUploadEntry, RemoteEntry } from '@shared/types'
import type { FileViewMode, SortColumn, SortDirection } from '@/app-types'
import { formatDate, formatSize, getParentPath } from '@/app-utils'
import FileEntryCollection from './FileEntryCollection'
import FilePathBar, { type Breadcrumb } from './FilePathBar'
import { useFileDragAndDrop } from './useFileDragAndDrop'
import { isSelectionBackground, useFileSelection } from './useFileSelection'

interface FileBrowserProps {
  currentPath: string
  entries: RemoteEntry[]
  loading: boolean
  viewMode: FileViewMode
  breadcrumbs: Breadcrumb[]
  sort: { column: SortColumn; direction: SortDirection }
  sortedEntries: RemoteEntry[]
  selectedPaths: string[]
  operationStatus: 'copy' | 'move' | 'extract' | null
  highlightedPath: string | null
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => Promise<boolean>
  onToggleSort: (column: SortColumn) => void
  onSelectedPathsChange: (paths: string[]) => void
  onOpenEntryContextMenu: (entries: RemoteEntry[], x: number, y: number, anchor: HTMLElement) => void
  onOpenDirectoryContextMenu: (x: number, y: number, anchor: HTMLElement) => void
  onDeleteEntries: (entries: RemoteEntry[]) => void
  onDropUpload: (entries: DroppedUploadEntry[]) => void
  onDropMove: (sourcePaths: string[], targetDirectory: string) => void
  onCancelOperation: () => void
  onDropError: (error: unknown) => void
}

export default function FileBrowser({
  currentPath,
  entries,
  loading,
  viewMode,
  breadcrumbs,
  sort,
  sortedEntries,
  selectedPaths,
  operationStatus,
  highlightedPath,
  onViewModeChange,
  onNavigate,
  onToggleSort,
  onSelectedPathsChange,
  onOpenEntryContextMenu,
  onOpenDirectoryContextMenu,
  onDeleteEntries,
  onDropUpload,
  onDropMove,
  onCancelOperation,
  onDropError,
}: FileBrowserProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const [hoveredEntry, setHoveredEntry] = useState<{
    entry: RemoteEntry
    anchorLeft: number
    anchorTop: number
    anchorBottom: number
    left: number
    top: number
  } | null>(null)
  const {
    selectionRectangle,
    selectedPathsRef,
    handleSelectionPointerDown,
    handleEntryClick,
    consumeSuppressedBackgroundClick,
  } = useFileSelection({ contentRef, currentPath, entries, sortedEntries, selectedPaths, onSelectedPathsChange })

  const selectedContextEntries = () => {
    const paths = new Set(selectedPathsRef.current)
    return sortedEntries.filter((entry) => paths.has(entry.path))
  }

  const changeSelectedPaths = (paths: Iterable<string>) => onSelectedPathsChange([...new Set(paths)])

  const showEntryDetails = (entry: RemoteEntry, element: HTMLElement) => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    const bounds = element.getBoundingClientRect()
    setHoveredEntry({
      entry,
      anchorLeft: bounds.left,
      anchorTop: bounds.top,
      anchorBottom: bounds.bottom,
      left: bounds.left,
      top: bounds.bottom + 6,
    })
  }

  const scheduleEntryDetails = (entry: RemoteEntry, element: HTMLElement) => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    setHoveredEntry(null)
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null
      showEntryDetails(entry, element)
    }, 1000)
  }

  const cancelEntryDetails = () => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredEntry(null)
  }

  const hideEntryDetailsOnBlur = (event: ReactFocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    cancelEntryDetails()
  }
  const {
    dropActive,
    dropTargetPath,
    handleContentDragEnter: handleDragEnter,
    handleContentDragOver: handleDragOver,
    handleContentDragLeave: handleDragLeave,
    handleContentDrop: handleDrop,
    handleEntryDragStart,
    handleEntryDragOver,
    handleEntryDragLeave,
    handleEntryDrop,
  } = useFileDragAndDrop({
    sortedEntries,
    selectedPathsRef,
    operationActive: operationStatus !== null,
    onDropUpload,
    onDropMove,
    onDropError,
    onDragStart: cancelEntryDetails,
  })

  useEffect(() => {
    if (!highlightedPath) return
    const target = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-entry-path]') ?? [])
      .find((element) => element.dataset.entryPath === highlightedPath)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target?.focus({ preventScroll: true })
  }, [highlightedPath, sortedEntries, viewMode])

  useEffect(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredEntry(null)
  }, [currentPath, entries, sortedEntries, viewMode])

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    if (!hoveredEntry || !hoverCardRef.current) return

    const cardBounds = hoverCardRef.current.getBoundingClientRect()
    const viewportPadding = 8
    const gap = 6
    const belowTop = hoveredEntry.anchorBottom + gap
    const aboveTop = hoveredEntry.anchorTop - cardBounds.height - gap
    const spaceBelow = window.innerHeight - belowTop - viewportPadding
    const spaceAbove = hoveredEntry.anchorTop - gap - viewportPadding
    const canFitBelow = cardBounds.height <= spaceBelow
    const canFitAbove = cardBounds.height <= spaceAbove
    const preferredTop = canFitBelow
      ? belowTop
      : canFitAbove
        ? aboveTop
        : spaceBelow >= spaceAbove
          ? belowTop
          : aboveTop
    const top = Math.max(viewportPadding, Math.min(preferredTop, window.innerHeight - cardBounds.height - viewportPadding))
    const left = Math.max(viewportPadding, Math.min(hoveredEntry.anchorLeft, window.innerWidth - cardBounds.width - viewportPadding))

    if (left !== hoveredEntry.left || top !== hoveredEntry.top) {
      setHoveredEntry((current) => current?.entry.path === hoveredEntry.entry.path
        ? { ...current, left, top }
        : current)
    }
  }, [hoveredEntry])

  const handleEntryContextMenu = (event: ReactMouseEvent<HTMLElement>, entry: RemoteEntry) => {
    event.preventDefault()
    event.stopPropagation()
    const currentSelection = new Set(selectedPathsRef.current)
    const targets = currentSelection.has(entry.path) ? selectedContextEntries() : [entry]
    if (!currentSelection.has(entry.path)) changeSelectedPaths([entry.path])
    if (targets.length > 0) onOpenEntryContextMenu([...targets], event.clientX, event.clientY, event.currentTarget)
  }

  const handleBackgroundContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const content = contentRef.current
    if (!content || !content.contains(event.target as Node)) return
    if (!isSelectionBackground(event.target)) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    changeSelectedPaths([])
    onOpenDirectoryContextMenu(event.clientX, event.clientY, content)
  }

  const handleBrowserKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const entryElement = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entry-path]') : null
    const focusedEntry = entryElement?.dataset.entryPath
      ? sortedEntries.find((entry) => entry.path === entryElement.dataset.entryPath)
      : undefined
    const targets = selectedContextEntries()
    if (event.key === 'Delete') {
      const allSelectedDeletable = targets.length > 0 && targets.every((entry) => entry.type === 'file' || entry.type === 'directory')
      const deletions = targets.length > 0
        ? allSelectedDeletable ? targets : []
        : focusedEntry && (focusedEntry.type === 'file' || focusedEntry.type === 'directory') ? [focusedEntry] : []
      if (deletions.length === 0) return
      event.preventDefault()
      onDeleteEntries(deletions)
      return
    }
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    if (!focusedEntry || !entryElement) {
      changeSelectedPaths([])
      const bounds = contentRef.current?.getBoundingClientRect()
      if (bounds && contentRef.current) onOpenDirectoryContextMenu(bounds.left + 12, bounds.top + 12, contentRef.current)
      return
    }
    const currentSelection = new Set(selectedPathsRef.current)
    const menuEntries = currentSelection.has(focusedEntry.path) ? targets : [focusedEntry]
    if (!currentSelection.has(focusedEntry.path)) changeSelectedPaths([focusedEntry.path])
    const bounds = entryElement.getBoundingClientRect()
    onOpenEntryContextMenu([...menuEntries], bounds.left + 12, bounds.top + 12, entryElement)
  }

  return (
    <div className="file-browser" onContextMenu={handleBackgroundContextMenu}>
      <FilePathBar
        currentPath={currentPath}
        breadcrumbs={breadcrumbs}
        viewMode={viewMode}
        entryCount={entries.length}
        onViewModeChange={onViewModeChange}
        onNavigate={onNavigate}
      />
      <div
        className={'file-content-wrap' + (selectionRectangle ? ' selecting' : '')}
        ref={contentRef}
        tabIndex={0}
        onPointerDown={handleSelectionPointerDown}
        onKeyDown={handleBrowserKeyDown}
        onClick={(event) => {
          if ((event.target as Element).closest('[data-entry-path], button, a, input, select, textarea, th')) return
          if (consumeSuppressedBackgroundClick()) return
          if (!event.ctrlKey && !event.metaKey) changeSelectedPaths([])
        }}
        onScroll={() => setHoveredEntry(null)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => void handleDrop(event)}
      >
        {operationStatus && (
          <div className="remote-copy-status" role="status">
            <LoaderCircle className="spin" size={15} />
            <span>正在{operationStatus === 'copy' ? '复制' : operationStatus === 'move' ? '移动' : '解压'}…</span>
            <button type="button" className="icon-button" title="取消操作" aria-label="取消操作" onClick={onCancelOperation}><X size={14} /></button>
          </div>
        )}
        <FileEntryCollection
          selectedPaths={selectedPaths}
          highlightedPath={highlightedPath}
          sort={sort}
          sortedEntries={sortedEntries}
          viewMode={viewMode}
          dropTargetPath={dropTargetPath}
          hoveredPath={hoveredEntry?.entry.path ?? null}
          operationActive={operationStatus !== null}
          hoverCardRef={hoverCardRef}
          onToggleSort={onToggleSort}
          onEntryClick={handleEntryClick}
          onEntryContextMenu={handleEntryContextMenu}
          onEntryDragStart={handleEntryDragStart}
          onEntryDragOver={handleEntryDragOver}
          onEntryDragLeave={handleEntryDragLeave}
          onEntryDrop={handleEntryDrop}
          onOpenDirectory={(entry) => {
            if (entry.type === 'directory') void onNavigate(entry.path)
          }}
          onTileMouseEnter={scheduleEntryDetails}
          onTileMouseLeave={(event) => {
            if (event.relatedTarget instanceof Node && hoverCardRef.current?.contains(event.relatedTarget)) return
            cancelEntryDetails()
          }}
          onTileBlur={hideEntryDetailsOnBlur}
        />        {loading && <div className="table-state"><LoaderCircle className="spin" size={19} /> 正在读取目录</div>}
        {!loading && entries.length === 0 && <div className="table-state empty-directory"><Folder size={22} /> 此目录为空</div>}
        {dropActive && (
          <div className="file-drop-overlay" role="status">
            <Upload size={22} />
            <strong>松开以上传</strong>
            <span>目标目录：<code>{currentPath}</code></span>
          </div>
        )}
        {selectionRectangle && <div className="selection-marquee" style={selectionRectangle} aria-hidden="true" />}
      </div>
      {viewMode === 'icons' && hoveredEntry && (
        <div
          className="entry-hover-card"
          id="entry-hover-details"
          ref={hoverCardRef}
          role="tooltip"
          style={{ left: hoveredEntry.left, top: hoveredEntry.top }}
          onMouseLeave={() => setHoveredEntry(null)}
        >
          <div className="entry-hover-row"><span>名称</span><strong>{hoveredEntry.entry.name}</strong></div>
          <div className="entry-hover-row"><span>路径</span><span className="entry-hover-value path-value">{hoveredEntry.entry.path}</span></div>
          <div className="entry-hover-row"><span>大小</span><span className="entry-hover-value">{hoveredEntry.entry.type === 'directory' ? '—' : formatSize(hoveredEntry.entry.size)}</span></div>
          <div className="entry-hover-row"><span>修改时间</span><span className="entry-hover-value">{formatDate(hoveredEntry.entry.modifiedAt)}</span></div>
          <div className="entry-hover-row"><span>权限</span><code>{hoveredEntry.entry.permissions}</code></div>
        </div>
      )}
    </div>
  )
}
