import { ArrowDown, ArrowUp, ArrowUpDown, File, Folder, type LucideIcon } from 'lucide-react'
import type { DragEvent, FocusEvent, MouseEvent, RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { FileViewMode, SortColumn, SortDirection } from '@/app-types'
import { formatDate, formatSize } from '@/app-utils'

interface FileEntryCollectionProps {
  selectedPaths: string[]
  highlightedPath: string | null
  sort: { column: SortColumn; direction: SortDirection }
  sortedEntries: RemoteEntry[]
  viewMode: FileViewMode
  dropTargetPath: string | null
  hoveredPath: string | null
  operationActive: boolean
  hoverCardRef: RefObject<HTMLDivElement | null>
  onToggleSort: (column: SortColumn) => void
  onEntryClick: (path: string, event: MouseEvent<HTMLElement>) => void
  onEntryContextMenu: (event: MouseEvent<HTMLElement>, entry: RemoteEntry) => void
  onEntryDragStart: (entry: RemoteEntry, event: DragEvent<HTMLElement>) => void
  onEntryDragOver: (entry: RemoteEntry, event: DragEvent<HTMLElement>) => void
  onEntryDragLeave: (entry: RemoteEntry, event: DragEvent<HTMLElement>) => void
  onEntryDrop: (entry: RemoteEntry, event: DragEvent<HTMLElement>) => void
  onOpenDirectory: (entry: RemoteEntry) => void
  onTileMouseEnter: (entry: RemoteEntry, element: HTMLElement) => void
  onTileMouseLeave: (event: MouseEvent<HTMLElement>) => void
  onTileFocus: (entry: RemoteEntry, element: HTMLElement) => void
  onTileBlur: (event: FocusEvent<HTMLElement>) => void
}

function SortHeader({
  column,
  label,
  sort,
  onToggle,
}: {
  column: SortColumn
  label: string
  sort: FileEntryCollectionProps['sort']
  onToggle: (column: SortColumn) => void
}) {
  const active = sort.column === column
  const directionLabel = sort.direction === 'ascending' ? '升序' : '降序'
  const title = '按' + label + '排序' + (active ? '，当前' + directionLabel : '')
  const SortIcon: LucideIcon = active
    ? sort.direction === 'ascending' ? ArrowUp : ArrowDown
    : ArrowUpDown
  return (
    <button className={'sort-header ' + (active ? 'active' : '')} title={title} aria-label={title} onClick={() => onToggle(column)}>
      <span>{label}</span>
      <SortIcon size={13} />
    </button>
  )
}

export default function FileEntryCollection({
  selectedPaths,
  highlightedPath,
  sort,
  sortedEntries,
  viewMode,
  dropTargetPath,
  hoveredPath,
  operationActive,
  hoverCardRef,
  onToggleSort,
  onEntryClick,
  onEntryContextMenu,
  onEntryDragStart,
  onEntryDragOver,
  onEntryDragLeave,
  onEntryDrop,
  onOpenDirectory,
  onTileMouseEnter,
  onTileMouseLeave,
  onTileFocus,
  onTileBlur,
}: FileEntryCollectionProps) {
  if (viewMode === 'details') {
    return (
      <table className="file-table">
        <thead>
          <tr>
            <th className="name-col" aria-sort={sort.column === 'name' ? sort.direction : 'none'}><SortHeader column="name" label="名称" sort={sort} onToggle={onToggleSort} /></th>
            <th className="size-col" aria-sort={sort.column === 'size' ? sort.direction : 'none'}><SortHeader column="size" label="大小" sort={sort} onToggle={onToggleSort} /></th>
            <th className="date-col" aria-sort={sort.column === 'modifiedAt' ? sort.direction : 'none'}><SortHeader column="modifiedAt" label="修改时间" sort={sort} onToggle={onToggleSort} /></th>
            <th className="permission-col" aria-sort={sort.column === 'permissions' ? sort.direction : 'none'}><SortHeader column="permissions" label="权限" sort={sort} onToggle={onToggleSort} /></th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry) => (
            <tr
              className={'file-row ' + (entry.path === highlightedPath ? 'search-highlight ' : '') + (selectedPaths.includes(entry.path) ? 'selected ' : '') + (dropTargetPath === entry.path ? 'drop-target' : '')}
              key={entry.path}
              data-entry-path={entry.path}
              draggable={!operationActive && (entry.type === 'file' || entry.type === 'directory')}
              aria-selected={selectedPaths.includes(entry.path)}
              tabIndex={entry.path === highlightedPath ? 0 : -1}
              onClick={(event) => onEntryClick(entry.path, event)}
              onContextMenu={(event) => onEntryContextMenu(event, entry)}
              onDragStart={(event) => onEntryDragStart(entry, event)}
              onDragOver={(event) => onEntryDragOver(entry, event)}
              onDragLeave={(event) => onEntryDragLeave(entry, event)}
              onDrop={(event) => onEntryDrop(entry, event)}
            >
              <td className="name-col" title={entry.name}>
                <button
                  className={'entry-name ' + (entry.type === 'directory' ? 'directory-entry' : '')}
                  title={entry.name}
                  aria-pressed={selectedPaths.includes(entry.path)}
                  onDoubleClick={() => onOpenDirectory(entry)}
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
    )
  }

  return (
    <div className="file-icon-grid">
      {sortedEntries.map((entry) => (
        <article
          className={'file-tile ' + (entry.path === highlightedPath ? 'search-highlight ' : '') + (selectedPaths.includes(entry.path) ? 'selected ' : '') + (dropTargetPath === entry.path ? 'drop-target' : '')}
          key={entry.path}
          data-entry-path={entry.path}
          draggable={!operationActive && (entry.type === 'file' || entry.type === 'directory')}
          aria-label={entry.name}
          aria-describedby={hoveredPath === entry.path ? 'entry-hover-details' : undefined}
          tabIndex={entry.path === highlightedPath ? 0 : -1}
          onClick={(event) => onEntryClick(entry.path, event)}
          onMouseEnter={(event) => onTileMouseEnter(entry, event.currentTarget)}
          onMouseLeave={onTileMouseLeave}
          onFocus={(event) => onTileFocus(entry, event.currentTarget)}
          onBlur={onTileBlur}
          onContextMenu={(event) => onEntryContextMenu(event, entry)}
          onDragStart={(event) => onEntryDragStart(entry, event)}
          onDragOver={(event) => onEntryDragOver(entry, event)}
          onDragLeave={(event) => onEntryDragLeave(entry, event)}
          onDrop={(event) => onEntryDrop(entry, event)}
        >
          <button
            className={'file-tile-main ' + (entry.type === 'directory' ? 'directory-entry' : '')}
            aria-label={entry.name}
            aria-pressed={selectedPaths.includes(entry.path)}
            onDoubleClick={() => onOpenDirectory(entry)}
          >
            <span className={'tile-glyph ' + (entry.type === 'directory' ? 'folder-glyph' : '')}>
              {entry.type === 'directory' ? <Folder size={31} fill="currentColor" strokeWidth={1.7} /> : <File size={29} />}
            </span>
            <span className="tile-name">{entry.name}</span>
          </button>
        </article>
      ))}
    </div>
  )
}
