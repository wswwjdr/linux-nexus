import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronRight, ClipboardPaste, Copy, Eye, FileText, FolderOpen, FolderPlus, Pencil, Play, Scissors, Terminal, Trash2, Upload, type LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type RefObject } from 'react'
import type { FileTypeExtensions } from '@shared/types'
import type { ContextMenuPosition } from '@/app-types'
import {
  resolveFileContextMenu,
  type FileContextMenuContext,
  type FileMenuAction,
  type FileMenuActionNode,
  type FileMenuIcon,
  type FileMenuNode,
} from './file-menu'

interface FileContextMenuProps {
  context: FileContextMenuContext
  fileTypeExtensions: FileTypeExtensions
  position: ContextMenuPosition
  anchorRef: RefObject<HTMLElement | null>
  onAction: (action: FileMenuAction, context: FileContextMenuContext) => void
  onClose: () => void
  label?: string
}

const icons: Record<FileMenuIcon, LucideIcon> = {
  'arrow-down': ArrowDown,
  'arrow-up': ArrowUp,
  'arrow-up-down': ArrowUpDown,
  archive: Archive,
  check: Check,
  'clipboard-paste': ClipboardPaste,
  copy: Copy,
  eye: Eye,
  'file-text': FileText,
  'folder-open': FolderOpen,
  'folder-plus': FolderPlus,
  pencil: Pencil,
  play: Play,
  scissors: Scissors,
  terminal: Terminal,
  trash: Trash2,
  upload: Upload,
}

function menuLabel(context: FileContextMenuContext): string {
  if (context.kind === 'single-entry') return context.entry.name + '的操作'
  if (context.kind === 'multiple-entries') return context.entries.length + ' 个已选项目的操作'
  if (context.kind === 'search-result') return context.result.name + '的操作'
  return '当前目录的操作'
}

function MenuAction({
  node,
  className,
  onAction,
}: {
  node: FileMenuActionNode
  className: string
  onAction: (action: FileMenuAction) => void
}) {
  const Icon = node.icon ? icons[node.icon] : null
  const role = node.checked === undefined ? 'menuitem' : 'menuitemradio'
  return (
    <button
      type="button"
      className={className + (node.action.type === 'delete' ? ' danger-action' : '') + (node.action.type === 'preview' ? ' preview-action' : '') + (node.action.type === 'preview-log' ? ' log-preview-action' : '')}
      role={role}
      aria-checked={node.checked}
      aria-label={node.disabledReason ? `${node.label}，${node.disabledReason}` : undefined}
      title={node.disabledReason ?? node.description ?? node.label}
      disabled={node.disabled}
      onClick={() => onAction(node.action)}
    >
      <span className="context-menu-action-icon">{Icon && <Icon size={16} />}</span>
      <span className="context-menu-label">{node.label}</span>
    </button>
  )
}

export default function FileContextMenu({ context, fileTypeExtensions, position, anchorRef, onAction, onClose, label }: FileContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const openSubmenuTriggerRef = useRef<HTMLButtonElement>(null)
  const pendingSubmenuFocusRef = useRef<string | null>(null)
  const [menuPosition, setMenuPosition] = useState(position)
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const [submenuPosition, setSubmenuPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 })
  const nodes = useMemo(() => resolveFileContextMenu(context, fileTypeExtensions), [context, fileTypeExtensions])

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const left = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const top = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    setMenuPosition((current) => current.x === left && current.y === top ? current : { x: left, y: top })
  }, [position.x, position.y, nodes])

  useEffect(() => {
    const root = rootRef.current
    const firstItem = root?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')
    firstItem?.focus()
  }, [])

  useEffect(() => {
    const dismissOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    const dismiss = () => onClose()
    document.addEventListener('pointerdown', dismissOnOutsidePointer)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [onClose])

  useLayoutEffect(() => {
    if (!openSubmenu) return
    const trigger = openSubmenuTriggerRef.current
    const panel = rootRef.current?.querySelector<HTMLElement>('[data-submenu-panel="' + openSubmenu + '"]')
    if (!trigger || !panel) return
    const triggerBounds = trigger.getBoundingClientRect()
    const panelBounds = panel.getBoundingClientRect()
    const x = triggerBounds.right + panelBounds.width <= window.innerWidth - 8
      ? triggerBounds.right - 1
      : Math.max(8, triggerBounds.left - panelBounds.width + 1)
    const below = triggerBounds.top
    const top = below + panelBounds.height <= window.innerHeight - 8
      ? below
      : Math.max(8, triggerBounds.bottom - panelBounds.height)
    setSubmenuPosition({ x, y: top })
    if (pendingSubmenuFocusRef.current === openSubmenu) {
      pendingSubmenuFocusRef.current = null
      panel.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')?.focus()
    }
  }, [openSubmenu])

  const handleAction = (action: FileMenuAction) => onAction(action, context)

  const focusSubmenuTrigger = () => {
    openSubmenuTriggerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const activeItem = document.activeElement as HTMLElement
    const insideSubmenu = activeItem.closest('[data-submenu-panel]')
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (insideSubmenu && openSubmenu) {
        setOpenSubmenu(null)
        focusSubmenuTrigger()
      } else {
        onClose()
        if (anchorRef.current?.isConnected) anchorRef.current.focus({ preventScroll: true })
      }
      return
    }
    if (event.key === 'ArrowLeft' && insideSubmenu) {
      event.preventDefault()
      setOpenSubmenu(null)
      focusSubmenuTrigger()
      return
    }
    if (event.key === 'ArrowRight' && activeItem.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault()
      const trigger = activeItem as HTMLButtonElement
      const submenuId = trigger.dataset.submenuTrigger ?? null
      openSubmenuTriggerRef.current = trigger
      if (submenuId && openSubmenu === submenuId) {
        rootRef.current?.querySelector<HTMLElement>('[data-submenu-panel="' + submenuId + '"] [role="menuitem"]:not(:disabled), [data-submenu-panel="' + submenuId + '"] [role="menuitemradio"]:not(:disabled)')?.focus()
      } else {
        pendingSubmenuFocusRef.current = submenuId
        setOpenSubmenu(submenuId)
      }
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)',
    ) ?? [])
    if (!items.length) return
    event.preventDefault()
    const focusItem = (item: HTMLElement) => {
      item.focus()
      if (!item.closest('[data-submenu-panel]')) setOpenSubmenu(null)
    }
    if (event.key === 'Home') {
      focusItem(items[0])
      return
    }
    if (event.key === 'End') {
      const lastItem = items.at(-1)
      if (lastItem) focusItem(lastItem)
      return
    }
    const index = items.indexOf(activeItem)
    const step = event.key === 'ArrowDown' ? 1 : -1
    focusItem(items[(index + step + items.length) % items.length])
  }

  const renderNode = (node: FileMenuNode, actionClassName = 'entry-context-action'): ReactElement => {
    if (node.kind === 'separator') return <div className="context-menu-separator" role="separator" key={node.id} />
    if (node.kind === 'action') return <MenuAction node={node} className={actionClassName} onAction={handleAction} key={node.id} />
    const Icon = icons[node.icon]
    const isOpen = !node.disabled && openSubmenu === node.id
    return (
      <div
        className="context-submenu"
        data-submenu-id={node.id}
        key={node.id}
        onMouseEnter={(event) => {
          if (node.disabled) return
          openSubmenuTriggerRef.current = event.currentTarget.querySelector<HTMLButtonElement>('.submenu-trigger')
          setOpenSubmenu(node.id)
        }}
        onMouseLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenSubmenu(null)
        }}
      >
        <button
          type="button"
          className="entry-context-action submenu-trigger"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={node.disabledReason ? `${node.label}，${node.disabledReason}` : undefined}
          title={node.disabledReason ?? node.label}
          disabled={node.disabled}
          data-submenu-trigger={node.id}
          onFocus={(event) => { openSubmenuTriggerRef.current = event.currentTarget }}
          onClick={() => { if (!node.disabled) setOpenSubmenu(node.id) }}
        >
          <span className="submenu-trigger-label"><Icon size={16} /> {node.label}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {isOpen && (
          <div
            className="file-context-submenu-panel"
            data-submenu-panel={node.id}
            role="menu"
            aria-label={node.label}
            style={{ position: 'fixed', left: submenuPosition.x, top: submenuPosition.y }}
          >
            {node.children.map((child) => renderNode(child, 'file-context-submenu-item'))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="browser-context-menu"
      ref={rootRef}
      role="menu"
      aria-label={label ?? menuLabel(context)}
      style={{ left: menuPosition.x, top: menuPosition.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {nodes.map((node) => renderNode(node))}
    </div>
  )
}
