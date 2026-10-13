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
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { FileViewMode, SortColumn, SortDirection } from '../app-types'
import { formatDate, formatSize, getParentPath } from '../app-utils'

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
  onViewModeChange: (mode: FileViewMode) => void
  onNavigate: (path: string) => void
  onToggleSort: (column: SortColumn) => void
  onEntryContextMenu: (event: ReactMouseEvent<HTMLElement>, entry: RemoteEntry) => void
  onEntryKeyDown: (event: ReactKeyboardEvent<HTMLElement>, entry: RemoteEntry) => void
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
  onViewModeChange,
  onNavigate,
  onToggleSort,
  onEntryContextMenu,
  onEntryKeyDown,
}: FileBrowserProps) {
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

      <div className="file-content-wrap">
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
                  className="file-row"
                  key={entry.path}
                  tabIndex={entry.type === 'file' ? 0 : -1}
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
                className="file-tile"
                key={entry.path}
                title={entry.name}
                tabIndex={entry.type === 'file' ? 0 : -1}
                onContextMenu={(event) => onEntryContextMenu(event, entry)}
                onKeyDown={(event) => onEntryKeyDown(event, entry)}
              >
                <button
                  className={'file-tile-main ' + (entry.type === 'directory' ? 'directory-entry' : '')}
                  title={entry.name}
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
    </>
  )
}
