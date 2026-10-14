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
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { RemoteEntry } from '@shared/types'
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
  highlightedPath: string | null
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => void
  onToggleSort: (column: SortColumn) => void
  onEntryContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: RemoteEntry) => void
  onEntryKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entry: RemoteEntry) => void
  onBackgroundContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void
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
  highlightedPath,
  onViewModeChange,
  onNavigate,
  onToggleSort,
  onEntryContextMenu,
  onEntryKeyDown,
  onBackgroundContextMenu,
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

      <div className="file-content-wrap" ref={contentRef} onContextMenu={onBackgroundContextMenu} onScroll={() => setHoveredEntry(null)}>
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
                  className={'file-row ' + (entry.path === highlightedPath ? 'search-highlight' : '')}
                  key={entry.path}
                  data-entry-path={entry.path}
                  tabIndex={entry.type === 'file' || entry.path === highlightedPath ? 0 : -1}
                  onContextMenu={(event) => onEntryContextMenu(event, entry)}
                  onKeyDown={(event) => onEntryKeyDown(event, entry)}
                >
                  <td className="name-col" title={entry.name}>
                    <button className={'entry-name ' + (entry.type === 'directory' ? 'directory-entry' : '')} title={entry.name} onClick={() => entry.type === 'directory' && onNavigate(entry.path)} disabled={entry.type !== 'directory'}>
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
                className={'file-tile ' + (entry.path === highlightedPath ? 'search-highlight' : '')}
                key={entry.path}
                data-entry-path={entry.path}
                aria-label={entry.name}
                aria-describedby={hoveredEntry?.entry.path === entry.path ? 'entry-hover-details' : undefined}
                tabIndex={entry.type === 'file' || entry.path === highlightedPath ? 0 : -1}
                onMouseEnter={(event) => scheduleEntryDetails(entry, event.currentTarget)}
                onMouseLeave={(event) => {
                  if (event.relatedTarget instanceof Node && hoverCardRef.current?.contains(event.relatedTarget)) return
                  cancelEntryDetails()
                }}
                onFocus={(event) => showEntryDetails(entry, event.currentTarget)}
                onBlur={hideEntryDetailsOnBlur}
                onContextMenu={(event) => onEntryContextMenu(event, entry)}
                onKeyDown={(event) => onEntryKeyDown(event, entry)}
              >
                <button
                  className={'file-tile-main ' + (entry.type === 'directory' ? 'directory-entry' : '')}
                  aria-label={entry.name}
                  onClick={() => entry.type === 'directory' && onNavigate(entry.path)}
                  disabled={entry.type !== 'directory'}
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
