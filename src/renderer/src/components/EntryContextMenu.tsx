import { ArrowDownToLine, Copy, Eye, Trash2 } from 'lucide-react'
import type { KeyboardEvent, RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { EntryContextMenu as EntryContextMenuState } from '../app-types'

interface EntryContextMenuProps {
  menu: EntryContextMenuState
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPreview: (entry: RemoteEntry) => void
  onDownload: (entry: RemoteEntry) => void
  onCopyPath: (entry: RemoteEntry) => void
  onDelete: (entry: RemoteEntry) => void
}

export default function EntryContextMenu({
  menu,
  elementRef,
  onKeyDown,
  onPreview,
  onDownload,
  onCopyPath,
  onDelete,
}: EntryContextMenuProps) {
  return (
    <div
      className="entry-context-menu"
      ref={elementRef}
      role="menu"
      aria-label={menu.entry.name + '的操作'}
      style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {menu.entry.type === 'file' && (
        <button className="entry-context-action preview-action" role="menuitem" onClick={() => onPreview(menu.entry)}>
          <Eye size={16} /> 预览
        </button>
      )}
      <button className="entry-context-action download-action" role="menuitem" onClick={() => onDownload(menu.entry)}>
        <ArrowDownToLine size={16} /> {menu.entry.type === 'directory' ? '下载文件夹' : '下载文件'}
      </button>
      <button className="entry-context-action" role="menuitem" onClick={() => onCopyPath(menu.entry)}>
        <Copy size={16} /> 复制绝对路径
      </button>
      <button className="entry-context-action danger-action" role="menuitem" onClick={() => onDelete(menu.entry)}>
        <Trash2 size={16} /> 删除
      </button>
    </div>
  )
}
