import { ArrowDownToLine, ArrowUpDown, Check, ChevronRight, Copy, Eye, FolderPlus, Trash2, Upload } from 'lucide-react'
import { useState, type KeyboardEvent, type RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { SortColumn, SortDirection } from '@/app-types'
import type { BrowserContextMenu as BrowserContextMenuState } from '@/app-types'

const sortOptions: { column: SortColumn; label: string }[] = [
  { column: 'name', label: '名称' },
  { column: 'modifiedAt', label: '修改日期' },
  { column: 'type', label: '类型' },
  { column: 'size', label: '大小' },
  { column: 'permissions', label: '权限' },
]

interface FileContextMenuProps {
  menu: BrowserContextMenuState
  sort: { column: SortColumn; direction: SortDirection }
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onSelectSortColumn: (column: SortColumn) => void
  onSelectSortDirection: (direction: SortDirection) => void
  onPreview: (entry: RemoteEntry) => void
  onDownload: (entry: RemoteEntry) => void
  onCopyPath: (entry: RemoteEntry) => void
  onDelete: (entry: RemoteEntry) => void
  onCopyCurrentPath: () => void
  onCreateDirectory: () => void
  onUpload: () => void
}

export default function FileContextMenu({
  menu,
  sort,
  elementRef,
  onKeyDown,
  onSelectSortColumn,
  onSelectSortDirection,
  onPreview,
  onDownload,
  onCopyPath,
  onDelete,
  onCopyCurrentPath,
  onCreateDirectory,
  onUpload,
}: FileContextMenuProps) {
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const menuWidth = 204
  const submenuWidth = 184
  const submenuHeight = sortOptions.length * 34 + 2 + 9 + 2 * 34 + 16
  const opensLeft = menu.x + menuWidth + submenuWidth > window.innerWidth - 8
  const opensUp = menu.y + submenuHeight > window.innerHeight - 8

  return (
    <div
      className="browser-context-menu"
      ref={elementRef}
      role="menu"
      aria-label={menu.kind === 'entry' ? menu.entry.name + '的操作' : '当前目录的操作'}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {menu.kind === 'entry' ? (
        <>
          {menu.entry.type === 'file' && (
            <button className="entry-context-action preview-action" role="menuitem" onClick={() => onPreview(menu.entry)}>
              <Eye size={16} /> 预览
            </button>
          )}
          <button className="entry-context-action download-action" role="menuitem" onClick={() => onDownload(menu.entry)}>
            <ArrowDownToLine size={16} /> {menu.entry.type === 'directory' ? '下载文件夹' : '下载文件'}
          </button>
          <button className="entry-context-action" role="menuitem" onClick={() => onCopyPath(menu.entry)}>
            <Copy size={16} /> 复制路径
          </button>
          <button className="entry-context-action danger-action" role="menuitem" onClick={() => onDelete(menu.entry)}>
            <Trash2 size={16} /> 删除
          </button>
        </>
      ) : (
        <>
          <div
            className="context-submenu"
            onMouseEnter={() => setSortMenuOpen(true)}
            onMouseLeave={() => {
              if (!(document.activeElement as HTMLElement).closest('.sort-submenu-panel')) setSortMenuOpen(false)
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSortMenuOpen(false)
            }}
          >
            <button
              className="entry-context-action submenu-trigger"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sortMenuOpen}
              onFocus={() => setSortMenuOpen(true)}
              onClick={() => setSortMenuOpen(true)}
            >
              <span className="submenu-trigger-label"><ArrowUpDown size={16} /> 排序方式</span>
              <ChevronRight size={14} />
            </button>
            {sortMenuOpen && (
              <div
                className={'sort-submenu-panel' + (opensLeft ? ' opens-left' : '') + (opensUp ? ' opens-up' : '')}
                role="menu"
                aria-label="排序方式"
              >
                {sortOptions.map((option) => (
                  <button
                    key={option.column}
                    className="sort-menu-item"
                    role="menuitemradio"
                    aria-checked={sort.column === option.column}
                    onClick={() => onSelectSortColumn(option.column)}
                  >
                    <span className="sort-menu-mark">{sort.column === option.column && <Check size={14} />}</span>
                    {option.label}
                  </button>
                ))}
                <div className="sort-menu-divider" role="separator" />
                {([
                  ['ascending', '递增'],
                  ['descending', '递减'],
                ] as const).map(([direction, label]) => (
                  <button
                    key={direction}
                    className="sort-menu-item"
                    role="menuitemradio"
                    aria-checked={sort.direction === direction}
                    onClick={() => onSelectSortDirection(direction)}
                  >
                    <span className="sort-menu-mark">{sort.direction === direction && <Check size={14} />}</span>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="entry-context-action" role="menuitem" onClick={onCopyCurrentPath}>
            <Copy size={16} /> 复制路径
          </button>
          <button className="entry-context-action" role="menuitem" onClick={onCreateDirectory}>
            <FolderPlus size={16} /> 新建文件夹
          </button>
          <button className="entry-context-action" role="menuitem" onClick={onUpload}>
            <Upload size={16} /> 上传
          </button>
        </>
      )}
    </div>
  )
}
