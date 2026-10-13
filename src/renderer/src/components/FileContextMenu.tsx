import { ArrowDownToLine, Copy, Eye, FolderPlus, Trash2, Upload } from 'lucide-react'
import type { KeyboardEvent, RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { BrowserContextMenu as BrowserContextMenuState } from '@/app-types'

interface FileContextMenuProps {
  menu: BrowserContextMenuState
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
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
  elementRef,
  onKeyDown,
  onPreview,
  onDownload,
  onCopyPath,
  onDelete,
  onCopyCurrentPath,
  onCreateDirectory,
  onUpload,
}: FileContextMenuProps) {
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
