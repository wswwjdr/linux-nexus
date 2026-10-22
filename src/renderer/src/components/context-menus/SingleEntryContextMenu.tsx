import { ArrowDownToLine, ChevronRight, ClipboardPaste, Copy, Eye, FileText, Pencil, Play, Scissors, Terminal, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent, type RefObject } from 'react'
import type { FileTypeExtensions, PreviewType, RemoteEntry } from '@shared/types'
import { previewTypesForFile, previewTypeLabels } from '@shared/preview-file-type'
import { classifyFileTypeCategories } from '@shared/file-type-categories'
import type { ContextMenuPosition } from '@/app-types'
import ContextMenuContainer from './ContextMenuContainer'

interface SingleEntryContextMenuProps {
  entry: RemoteEntry
  position: ContextMenuPosition
  fileTypeExtensions: FileTypeExtensions
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  onPreview: (entry: RemoteEntry, type: PreviewType) => void
  onPreviewLog: (entry: RemoteEntry) => void
  onRunScript: (entry: RemoteEntry) => void
  onAdjustAndRunScript: (entry: RemoteEntry) => void
  onDownload: (entry: RemoteEntry) => void
  canPaste: boolean
  onCopyEntry: (entry: RemoteEntry) => void
  onCutEntry: (entry: RemoteEntry) => void
  onPasteToDirectory: (directory: string) => void
  onPasteToCurrentDirectory: () => void
  onCopyPath: (entry: RemoteEntry) => void
  onDelete: (entry: RemoteEntry) => void
}

export default function SingleEntryContextMenu({
  entry,
  position,
  fileTypeExtensions,
  elementRef,
  onKeyDown,
  onPreview,
  onPreviewLog,
  onRunScript,
  onAdjustAndRunScript,
  onDownload,
  canPaste,
  onCopyEntry,
  onCutEntry,
  onPasteToDirectory,
  onPasteToCurrentDirectory,
  onCopyPath,
  onDelete,
}: SingleEntryContextMenuProps) {
  const [previewMenuOpen, setPreviewMenuOpen] = useState(false)
  const [scriptMenuOpen, setScriptMenuOpen] = useState(false)
  const previewOptions = entry.type === 'file' ? previewTypesForFile(entry.name, fileTypeExtensions) : []
  const isScript = entry.type === 'file' && classifyFileTypeCategories(entry.name, fileTypeExtensions).includes('script')
  const menuWidth = 204
  const submenuWidth = 184
  const previewMenuHeight = previewOptions.length * 36 + 8
  const scriptMenuHeight = 2 * 36 + 8
  const opensLeft = position.x + menuWidth + submenuWidth > window.innerWidth - 8
  const opensUp = position.y + Math.max(previewMenuHeight, isScript ? scriptMenuHeight : 0) > window.innerHeight - 8

  return (
    <ContextMenuContainer
      position={position}
      label={entry.name + '的操作'}
      elementRef={elementRef}
      onKeyDown={onKeyDown}
    >
      {entry.type === 'file' && (
        <>
          {previewOptions.length === 1 && (
            <button className="entry-context-action preview-action" role="menuitem" onClick={() => onPreview(entry, previewOptions[0])}>
              <Eye size={16} /> 预览
            </button>
          )}
          {previewOptions.length > 1 && (
            <div className="context-submenu" onMouseEnter={() => setPreviewMenuOpen(true)} onMouseLeave={() => {
              if (!(document.activeElement as HTMLElement).closest('.sort-submenu-panel')) setPreviewMenuOpen(false)
            }} onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreviewMenuOpen(false)
            }}>
              <button className="entry-context-action preview-action submenu-trigger" role="menuitem" aria-haspopup="menu" aria-expanded={previewMenuOpen} onFocus={() => setPreviewMenuOpen(true)} onClick={() => setPreviewMenuOpen(true)}>
                <span className="submenu-trigger-label"><Eye size={16} /> 预览</span>
                <ChevronRight size={14} />
              </button>
              {previewMenuOpen && (
                <div className={'sort-submenu-panel' + (opensLeft ? ' opens-left' : '') + (opensUp ? ' opens-up' : '')} role="menu" aria-label="预览方式">
                  {previewOptions.map((type) => (
                    <button key={type} className="sort-menu-item" role="menuitem" onClick={() => onPreview(entry, type)}>
                      <span className="sort-menu-mark" />{previewTypeLabels[type]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {previewOptions.includes('text') && (
            <button className="entry-context-action log-preview-action" role="menuitem" onClick={() => onPreviewLog(entry)}>
              <FileText size={16} /> 倒序预览
            </button>
          )}
          {isScript && (
            <div className="context-submenu" onMouseEnter={() => setScriptMenuOpen(true)} onMouseLeave={() => {
              if (!(document.activeElement as HTMLElement).closest('.sort-submenu-panel')) setScriptMenuOpen(false)
            }} onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setScriptMenuOpen(false)
            }}>
              <button className="entry-context-action submenu-trigger" role="menuitem" aria-haspopup="menu" aria-expanded={scriptMenuOpen} onFocus={() => setScriptMenuOpen(true)} onClick={() => setScriptMenuOpen(true)}>
                <span className="submenu-trigger-label"><Terminal size={16} /> 执行</span>
                <ChevronRight size={14} />
              </button>
              {scriptMenuOpen && (
                <div className={'sort-submenu-panel' + (opensLeft ? ' opens-left' : '') + (opensUp ? ' opens-up' : '')} role="menu" aria-label="执行脚本">
                  <button className="sort-menu-item" role="menuitem" onClick={() => onRunScript(entry)}>
                    <Play size={15} /> 执行
                  </button>
                  <button className="sort-menu-item" role="menuitem" onClick={() => onAdjustAndRunScript(entry)}>
                    <Pencil size={15} /> 调整并执行
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <button className="entry-context-action download-action" role="menuitem" onClick={() => onDownload(entry)}>
        <ArrowDownToLine size={16} /> {entry.type === 'directory' ? '下载文件夹' : '下载文件'}
      </button>
      <button className="entry-context-action" role="menuitem" onClick={() => onCopyEntry(entry)}>
        <Copy size={16} /> 复制
      </button>
      <button className="entry-context-action" role="menuitem" onClick={() => onCutEntry(entry)}>
        <Scissors size={16} /> 剪切
      </button>
      {entry.type === 'directory' && (
        <button className="entry-context-action" role="menuitem" disabled={!canPaste} onClick={() => onPasteToDirectory(entry.path)}>
          <ClipboardPaste size={16} /> 粘贴到文件夹
        </button>
      )}
      {entry.type !== 'directory' && (
        <button className="entry-context-action" role="menuitem" disabled={!canPaste} onClick={onPasteToCurrentDirectory}>
          <ClipboardPaste size={16} /> 粘贴到当前目录
        </button>
      )}
      <button className="entry-context-action" role="menuitem" onClick={() => onCopyPath(entry)}>
        <Copy size={16} /> 复制路径
      </button>
      <button className="entry-context-action danger-action" role="menuitem" onClick={() => onDelete(entry)}>
        <Trash2 size={16} /> 删除
      </button>
    </ContextMenuContainer>
  )
}
