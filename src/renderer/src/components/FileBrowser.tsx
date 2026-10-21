import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronRight,
  File,
  Folder,
  House,
  LayoutGrid,
  List,
  LoaderCircle,
  MoveRight,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { DroppedUploadEntry, RemoteEntry, RemoteMoveProgress } from '@shared/types'
import type { FileViewMode, SortColumn, SortDirection } from '@/app-types'
import { formatDate, formatSize, getParentPath } from '@/app-utils'

interface Breadcrumb {
  label: string
  path: string
}

interface FileBrowserProps {
  currentPath: string
  entries: RemoteEntry[]
  loading: boolean
  viewMode: FileViewMode
  breadcrumbs: Breadcrumb[]
  sort: { column: SortColumn; direction: SortDirection }
  sortedEntries: RemoteEntry[]
  selectedPaths: string[]
  moveProgress: RemoteMoveProgress | null
  copying: boolean
  highlightedPath: string | null
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => void
  onToggleSort: (column: SortColumn) => void
  onSelectedPathsChange: (paths: string[]) => void
  onOpenEntryContextMenu: (entries: RemoteEntry[], x: number, y: number) => void
  onOpenDirectoryContextMenu: (x: number, y: number) => void
  onDeleteEntries: (entries: RemoteEntry[]) => void
  onDropUpload: (entries: DroppedUploadEntry[]) => void
  onDropMove: (sourcePaths: string[], targetDirectory: string) => void
  onCancelMove: () => void
  onDropError: (error: unknown) => void
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
}

const remoteMoveMime = 'application/x-linux-nexus-remote-files'

function hasRemoteMove(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(remoteMoveMime)
}

function readRemoteMovePaths(dataTransfer: DataTransfer): string[] {
  try {
    const paths: unknown = JSON.parse(dataTransfer.getData(remoteMoveMime))
    return Array.isArray(paths) && paths.every((path) => typeof path === 'string') ? paths : []
  } catch {
    return []
  }
}

function isSelectionBackground(target: EventTarget | null): boolean {
  return target instanceof Element && !target.closest('[data-entry-path], button, a, input, select, textarea, th, .file-drop-overlay')
}

interface SelectionDrag {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  additive: boolean
  initialPaths: string[]
  moved: boolean
}

interface SelectionRectangle {
  left: number
  top: number
  width: number
  height: number
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

function readDirectoryBatch(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject))
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  const children: FileSystemEntry[] = []
  while (true) {
    const batch = await readDirectoryBatch(reader)
    if (batch.length === 0) return children
    children.push(...batch)
  }
}

async function droppedFile(file: File, relativePath: string): Promise<DroppedUploadEntry> {
  const localPath = window.remoteFiles.getPathForFile(file)
  if (!localPath) throw new Error('无法读取拖入文件的本机路径：' + file.name)
  return { relativePath, type: 'file', localPath }
}

async function readDroppedEntry(entry: FileSystemEntry, parentPath: string): Promise<DroppedUploadEntry[]> {
  const relativePath = parentPath ? parentPath + '/' + entry.name : entry.name
  if (entry.isFile) return [await droppedFile(await readFileEntry(entry as FileSystemFileEntry), relativePath)]
  if (!entry.isDirectory) throw new Error('拖入内容包含暂不支持的文件类型')

  const children = await readDirectoryEntries(entry as FileSystemDirectoryEntry)
  const descendants = await Promise.all(children.map((child) => readDroppedEntry(child, relativePath)))
  return [{ relativePath, type: 'directory' }, ...descendants.flat()]
}

async function collectDroppedEntries(dataTransfer: DataTransfer): Promise<DroppedUploadEntry[]> {
  const roots: FileSystemEntry[] = []
  const standaloneFiles: File[] = []
  for (const item of Array.from(dataTransfer.items).filter((candidate) => candidate.kind === 'file')) {
    const entry = item.webkitGetAsEntry()
    if (entry) roots.push(entry)
    else {
      const file = item.getAsFile()
      if (file) standaloneFiles.push(file)
    }
  }

  if (roots.length === 0 && standaloneFiles.length === 0) standaloneFiles.push(...Array.from(dataTransfer.files))
  const rootEntries = await Promise.all(roots.map((entry) => readDroppedEntry(entry, '')))
  const files = await Promise.all(standaloneFiles.map((file) => droppedFile(file, file.name)))
  return [...rootEntries.flat(), ...files]
}

function SortHeader({
  column,
  label,
  sort,
  onToggle,
}: {
  column: SortColumn
  label: string
  sort: FileBrowserProps['sort']
  onToggle: (column: SortColumn) => void
}) {
  const active = sort.column === column
  const directionLabel = sort.direction === 'ascending' ? '升序' : '降序'
  return (
    <button
      className={'sort-header ' + (active ? 'active' : '')}
      title={'按' + label + '排序' + (active ? '，当前' + directionLabel : '')}
      aria-label={'按' + label + '排序' + (active ? '，当前' + directionLabel : '')}
      onClick={() => onToggle(column)}
    >
      <span>{label}</span>
      {active
        ? sort.direction === 'ascending' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
        : <ArrowUpDown size={13} />}
    </button>
  )
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
  moveProgress,
  copying,
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
  onCancelMove,
  onDropError,
}: FileBrowserProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const hoverCardRef = useRef<HTMLDivElement>(null)
  const hoverTimerRef = useRef<number | null>(null)
  const dragDepthRef = useRef(0)
  const selectionDragRef = useRef<SelectionDrag | null>(null)
  const selectedPathsRef = useRef(selectedPaths)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)
  const [selectionRectangle, setSelectionRectangle] = useState<SelectionRectangle | null>(null)
  const [hoveredEntry, setHoveredEntry] = useState<{
    entry: RemoteEntry
    anchorLeft: number
    anchorTop: number
    anchorBottom: number
    left: number
    top: number
  } | null>(null)
  selectedPathsRef.current = selectedPaths

  const selectedEntries = () => {
    const paths = new Set(selectedPathsRef.current)
    return sortedEntries.filter((entry) => paths.has(entry.path) && (entry.type === 'file' || entry.type === 'directory'))
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

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!hasDraggedFiles(event.dataTransfer)) return
    dragDepthRef.current += 1
    setDropActive(true)
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (hasRemoteMove(event.dataTransfer)) {
      const targetElement = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entry-path]') : null
      const target = targetElement?.dataset.entryPath
        ? sortedEntries.find((entry) => entry.path === targetElement.dataset.entryPath)
        : undefined
      const sourcePaths = readRemoteMovePaths(event.dataTransfer)
      event.dataTransfer.dropEffect = !moveProgress && !copying && target?.type === 'directory' && !sourcePaths.includes(target.path) ? 'move' : 'none'
      return
    }
    event.dataTransfer.dropEffect = hasDraggedFiles(event.dataTransfer) ? 'copy' : 'none'
  }

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (dragDepthRef.current === 0) return
    dragDepthRef.current -= 1
    if (dragDepthRef.current === 0) setDropActive(false)
  }

  const handleDrop = async (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDropActive(false)
    if (hasRemoteMove(event.dataTransfer)) return
    if (!hasDraggedFiles(event.dataTransfer)) return
    try {
      onDropUpload(await collectDroppedEntries(event.dataTransfer))
    } catch (error) {
      onDropError(error)
    }
  }

  const handleEntryDragStart = (entry: RemoteEntry, event: ReactDragEvent<HTMLElement>) => {
    if (moveProgress || copying || (entry.type !== 'file' && entry.type !== 'directory')) {
      event.preventDefault()
      return
    }
    const selected = new Set(selectedPathsRef.current)
    const sources = selected.has(entry.path) ? selectedEntries() : [entry]
    const paths = sources
      .filter((candidate) => candidate.type === 'file' || candidate.type === 'directory')
      .map((candidate) => candidate.path)
    if (paths.length === 0) {
      event.preventDefault()
      return
    }
    cancelEntryDetails()
    event.dataTransfer.setData(remoteMoveMime, JSON.stringify(paths))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleEntryDragOver = (entry: RemoteEntry, event: ReactDragEvent<HTMLElement>) => {
    if (!hasRemoteMove(event.dataTransfer)) return
    event.preventDefault()
    const paths = readRemoteMovePaths(event.dataTransfer)
    const validTarget = !moveProgress && !copying && entry.type === 'directory' && paths.length > 0 && !paths.includes(entry.path)
    event.dataTransfer.dropEffect = validTarget ? 'move' : 'none'
    setDropTargetPath(validTarget ? entry.path : null)
  }

  const handleEntryDragLeave = (entry: RemoteEntry, event: ReactDragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setDropTargetPath((current) => current === entry.path ? null : current)
  }

  const handleEntryDrop = (entry: RemoteEntry, event: ReactDragEvent<HTMLElement>) => {
    if (!hasRemoteMove(event.dataTransfer)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTargetPath(null)
    const paths = readRemoteMovePaths(event.dataTransfer)
    if (moveProgress || copying || entry.type !== 'directory' || paths.length === 0) return
    if (paths.includes(entry.path)) {
      onDropError(new Error('不能将文件夹移动到自身'))
      return
    }
    onDropMove(paths, entry.path)
  }

  const handleSelectionPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    if (!isSelectionBackground(event.target)) return
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    suppressClickRef.current = false
    event.preventDefault()
    selectionDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive: event.ctrlKey || event.metaKey,
      initialPaths: selectedPathsRef.current,
      moved: false,
    }
  }

  const handleEntryClick = (path: string, event: ReactMouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedPathsRef.current)
        if (next.has(path)) next.delete(path)
        else next.add(path)
      changeSelectedPaths(next)
      return
    }
    changeSelectedPaths([path])
  }

  const consumeSuppressedBackgroundClick = () => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    return true
  }

  useEffect(() => {
    const updateSelection = (event: PointerEvent) => {
      const drag = selectionDragRef.current
      const content = contentRef.current
      const bounds = content?.getBoundingClientRect()
      if (!drag || !content || !bounds || drag.pointerId !== event.pointerId) return

      const currentX = Math.max(bounds.left, Math.min(event.clientX, bounds.right))
      const currentY = Math.max(bounds.top, Math.min(event.clientY, bounds.bottom))
      const moved = drag.moved || Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4
      const updatedDrag = { ...drag, currentX, currentY, moved }
      selectionDragRef.current = updatedDrag

      if (!moved) return
      const rectangle = {
        left: Math.min(drag.startX, currentX),
        top: Math.min(drag.startY, currentY),
        right: Math.max(drag.startX, currentX),
        bottom: Math.max(drag.startY, currentY),
      }
      setSelectionRectangle({
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.right - rectangle.left,
        height: rectangle.bottom - rectangle.top,
      })

      const next = new Set(drag.additive ? drag.initialPaths : [])
      for (const element of content.querySelectorAll<HTMLElement>('[data-entry-path]')) {
        const item = element.getBoundingClientRect()
        if (item.right >= rectangle.left && item.left <= rectangle.right && item.bottom >= rectangle.top && item.top <= rectangle.bottom) {
          const path = element.dataset.entryPath
          if (path) next.add(path)
        }
      }
      changeSelectedPaths(next)
    }

    const handlePointerMove = (event: PointerEvent) => updateSelection(event)
    const handlePointerUp = (event: PointerEvent) => {
      const drag = selectionDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      updateSelection(event)
      const moved = selectionDragRef.current?.moved ?? false
      selectionDragRef.current = null
      setSelectionRectangle(null)
      if (moved) {
        contentRef.current?.focus({ preventScroll: true })
        suppressClickRef.current = true
        suppressClickTimerRef.current = window.setTimeout(() => {
          suppressClickRef.current = false
          suppressClickTimerRef.current = null
        }, 0)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [onSelectedPathsChange, sortedEntries])

  useEffect(() => {
    if (!highlightedPath) return
    const target = Array.from(contentRef.current?.querySelectorAll<HTMLElement>('[data-entry-path]') ?? [])
      .find((element) => element.dataset.entryPath === highlightedPath)
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target?.focus({ preventScroll: true })
  }, [highlightedPath, sortedEntries, viewMode])

  useEffect(() => {
    selectionDragRef.current = null
    setSelectionRectangle(null)
  }, [currentPath, entries])

  useEffect(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHoveredEntry(null)
  }, [currentPath, entries, sortedEntries, viewMode])

  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current)
    if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
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
    const targets = currentSelection.has(entry.path) ? selectedEntries() : [entry]
    if (!currentSelection.has(entry.path)) changeSelectedPaths([entry.path])
    const actionableEntries = targets.filter((candidate) => candidate.type === 'file' || candidate.type === 'directory')
    if (actionableEntries.length > 0) onOpenEntryContextMenu([...actionableEntries], event.clientX, event.clientY)
  }

  const handleBackgroundContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isSelectionBackground(event.target)) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    changeSelectedPaths([])
    onOpenDirectoryContextMenu(event.clientX, event.clientY)
  }

  const handleBrowserKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const entryElement = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-entry-path]') : null
    const focusedEntry = entryElement?.dataset.entryPath
      ? sortedEntries.find((entry) => entry.path === entryElement.dataset.entryPath)
      : undefined
    const targets = selectedEntries()
    if (event.key === 'Delete') {
      const deletions = targets.length > 0 ? targets : focusedEntry && (focusedEntry.type === 'file' || focusedEntry.type === 'directory') ? [focusedEntry] : []
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
      if (bounds) onOpenDirectoryContextMenu(bounds.left + 12, bounds.top + 12)
      return
    }
    const currentSelection = new Set(selectedPathsRef.current)
    const menuEntries = currentSelection.has(focusedEntry.path) ? targets : [focusedEntry]
    if (!currentSelection.has(focusedEntry.path)) changeSelectedPaths([focusedEntry.path])
    const actionableEntries = menuEntries.filter((entry) => entry.type === 'file' || entry.type === 'directory')
    if (actionableEntries.length === 0) return
    const bounds = entryElement.getBoundingClientRect()
    onOpenEntryContextMenu([...actionableEntries], bounds.left + 12, bounds.top + 12)
  }

  return (
    <>
      <div className="pathbar">
        <button className="icon-button path-nav" title="返回根目录" aria-label="返回根目录" disabled={currentPath === '/'} onClick={() => onNavigate('/')}>
          <House size={16} />
        </button>
        <button className="icon-button path-nav nav-group-end" title="返回上级目录" aria-label="返回上级目录" disabled={currentPath === '/'} onClick={() => onNavigate(getParentPath(currentPath))}>
          <ArrowUp size={16} />
        </button>
        <nav className="breadcrumbs" aria-label="当前路径">
          {breadcrumbs.map((crumb, index) => (
            <span className="breadcrumb-piece" key={crumb.path}>
              {index > 0 && <ChevronRight size={13} />}
              <button className={index === breadcrumbs.length - 1 ? 'current-crumb' : ''} onClick={() => onNavigate(crumb.path)}>{crumb.label}</button>
            </span>
          ))}
        </nav>
        <div className="pathbar-tools">
          <div className="view-toggle" role="group" aria-label="文件视图">
            <button className="view-toggle-button" title="图标视图" aria-label="图标视图" aria-pressed={viewMode === 'icons'} onClick={() => onViewModeChange('icons')}>
              <LayoutGrid size={16} />
            </button>
            <button className="view-toggle-button" title="详细信息视图" aria-label="详细信息视图" aria-pressed={viewMode === 'details'} onClick={() => onViewModeChange('details')}>
              <List size={17} />
            </button>
          </div>
          <div className="path-count">{entries.length} 项</div>
        </div>
      </div>

      <div
        className={'file-content-wrap' + (selectionRectangle ? ' selecting' : '')}
        ref={contentRef}
        tabIndex={0}
        onPointerDown={handleSelectionPointerDown}
        onContextMenu={handleBackgroundContextMenu}
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
        {moveProgress && (
          <div className="remote-move-status" role="status">
            <MoveRight size={15} />
            <span>
              正在移动 {moveProgress.completedCount}/{moveProgress.totalCount}
              {moveProgress.currentPath ? `：${moveProgress.currentPath.split('/').at(-1)}` : ''}
            </span>
            <button type="button" className="icon-button" title="取消移动" aria-label="取消移动" onClick={onCancelMove}><X size={14} /></button>
          </div>
        )}
        {copying && (
          <div className="remote-copy-status" role="status">
            <LoaderCircle className="spin" size={15} />
            <span>正在复制远端项目…</span>
          </div>
        )}
        {viewMode === 'details' ? (
          <table className="file-table">
            <thead>
              <tr>
                <th className="name-col" aria-sort={sort.column === 'name' ? sort.direction : 'none'}>
                  <SortHeader column="name" label="名称" sort={sort} onToggle={onToggleSort} />
                </th>
                <th className="size-col" aria-sort={sort.column === 'size' ? sort.direction : 'none'}>
                  <SortHeader column="size" label="大小" sort={sort} onToggle={onToggleSort} />
                </th>
                <th className="date-col" aria-sort={sort.column === 'modifiedAt' ? sort.direction : 'none'}>
                  <SortHeader column="modifiedAt" label="修改时间" sort={sort} onToggle={onToggleSort} />
                </th>
                <th className="permission-col" aria-sort={sort.column === 'permissions' ? sort.direction : 'none'}>
                  <SortHeader column="permissions" label="权限" sort={sort} onToggle={onToggleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map((entry) => (
                <tr
                  className={'file-row ' + (entry.path === highlightedPath ? 'search-highlight ' : '') + (selectedPaths.includes(entry.path) ? 'selected ' : '') + (dropTargetPath === entry.path ? 'drop-target' : '')}
                  key={entry.path}
                  data-entry-path={entry.path}
                  draggable={!moveProgress && !copying && (entry.type === 'file' || entry.type === 'directory')}
                  aria-selected={selectedPaths.includes(entry.path)}
                  tabIndex={entry.path === highlightedPath ? 0 : -1}
                  onClick={(event) => handleEntryClick(entry.path, event)}
                  onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                  onDragStart={(event) => handleEntryDragStart(entry, event)}
                  onDragOver={(event) => handleEntryDragOver(entry, event)}
                  onDragLeave={(event) => handleEntryDragLeave(entry, event)}
                  onDrop={(event) => handleEntryDrop(entry, event)}
                >
                  <td className="name-col" title={entry.name}>
                    <button
                      className={'entry-name ' + (entry.type === 'directory' ? 'directory-entry' : '')}
                      title={entry.name}
                      aria-pressed={selectedPaths.includes(entry.path)}
                      onDoubleClick={() => entry.type === 'directory' && onNavigate(entry.path)}
                    >
                      <span className={'entry-icon ' + (entry.type === 'directory' ? 'folder-icon' : '')}>
                        {entry.type === 'directory' ? <Folder size={17} fill="currentColor" strokeWidth={1.8} /> : <File size={16} />}
                      </span>
                      <span className="entry-label">{entry.name}</span>
                    </button>
                  </td>
                  <td className="size-col">{entry.type === 'directory' ? '—' : formatSize(entry.size)}</td>
                  <td className="date-col">{formatDate(entry.modifiedAt)}</td>
                  <td className="permission-col"><code>{entry.permissions}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="file-icon-grid">
            {sortedEntries.map((entry) => (
              <article
                className={'file-tile ' + (entry.path === highlightedPath ? 'search-highlight ' : '') + (selectedPaths.includes(entry.path) ? 'selected ' : '') + (dropTargetPath === entry.path ? 'drop-target' : '')}
                key={entry.path}
                data-entry-path={entry.path}
                draggable={!moveProgress && !copying && (entry.type === 'file' || entry.type === 'directory')}
                aria-label={entry.name}
                aria-describedby={hoveredEntry?.entry.path === entry.path ? 'entry-hover-details' : undefined}
                tabIndex={entry.path === highlightedPath ? 0 : -1}
                onClick={(event) => handleEntryClick(entry.path, event)}
                onMouseEnter={(event) => scheduleEntryDetails(entry, event.currentTarget)}
                onMouseLeave={(event) => {
                  if (event.relatedTarget instanceof Node && hoverCardRef.current?.contains(event.relatedTarget)) return
                  cancelEntryDetails()
                }}
                onFocus={(event) => {
                  showEntryDetails(entry, event.currentTarget)
                }}
                onBlur={hideEntryDetailsOnBlur}
                onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                onDragStart={(event) => handleEntryDragStart(entry, event)}
                onDragOver={(event) => handleEntryDragOver(entry, event)}
                onDragLeave={(event) => handleEntryDragLeave(entry, event)}
                onDrop={(event) => handleEntryDrop(entry, event)}
              >
                <button
                  className={'file-tile-main ' + (entry.type === 'directory' ? 'directory-entry' : '')}
                  aria-label={entry.name}
                  aria-pressed={selectedPaths.includes(entry.path)}
                  onDoubleClick={() => entry.type === 'directory' && onNavigate(entry.path)}
                >
                  <span className={'tile-glyph ' + (entry.type === 'directory' ? 'folder-glyph' : '')}>
                    {entry.type === 'directory'
                      ? <Folder size={31} fill="currentColor" strokeWidth={1.7} />
                      : <File size={29} />}
                  </span>
                  <span className="tile-name">{entry.name}</span>
                </button>
              </article>
            ))}
          </div>
        )}
        {loading && <div className="table-state"><LoaderCircle className="spin" size={19} /> 正在读取目录</div>}
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
    </>
  )
}
