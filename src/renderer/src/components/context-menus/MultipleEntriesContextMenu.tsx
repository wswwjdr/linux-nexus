import { ArrowDownToLine, Trash2 } from 'lucide-react'
import type { KeyboardEvent, RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { ContextMenuPosition } from '@/app-types'
import ContextMenuContainer from './ContextMenuContainer'

interface MultipleEntriesContextMenuProps {
  entries: RemoteEntry[]
  position: ContextMenuPosition
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onDownload: (entries: RemoteEntry[]) => void
  onDelete: (entries: RemoteEntry[]) => void
}

export default function MultipleEntriesContextMenu({ entries, position, elementRef, onKeyDown, onDownload, onDelete }: MultipleEntriesContextMenuProps) {
  return (
    <ContextMenuContainer
      position={position}
      label={`${entries.length} 个已选项目的操作`}
      elementRef={elementRef}
      onKeyDown={onKeyDown}
    >
      <button className="entry-context-action download-action" role="menuitem" onClick={() => onDownload(entries)}>
        <ArrowDownToLine size={16} /> 下载 {entries.length} 项
      </button>
      <button className="entry-context-action danger-action" role="menuitem" onClick={() => onDelete(entries)}>
        <Trash2 size={16} /> 删除 {entries.length} 项
      </button>
    </ContextMenuContainer>
  )
}
