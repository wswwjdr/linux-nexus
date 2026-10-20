import { useEffect, useRef } from 'react'
import { FolderOpen, Keyboard, Terminal, X } from 'lucide-react'

interface ShortcutItem {
  bindings: string[][]
  action: string
}

interface ShortcutGroup {
  id: string
  scope: string
  icon: typeof FolderOpen
  items: ShortcutItem[]
}

const shortcutGroups: ShortcutGroup[] = [
  {
    id: 'sftp',
    scope: 'SFTP 文件管理',
    icon: FolderOpen,
    items: [
      { bindings: [['Ctrl', 'F']], action: '打开文件搜索' },
      { bindings: [['Up'], ['Down'], ['Left'], ['Right']], action: '上/下键移动菜单焦点；左/右键切换排序子菜单' },
    ],
  },
  {
    id: 'ssh',
    scope: 'SSH 终端',
    icon: Terminal,
    items: [
      { bindings: [['鼠标右键']], action: '打开复制、粘贴菜单' },
      { bindings: [['Ctrl', 'Shift', 'C']], action: '复制选中的终端文本' },
      { bindings: [['Ctrl', 'Shift', 'V']], action: '粘贴系统剪贴板内容' },
    ],
  },
  {
    id: 'general',
    scope: '通用',
    icon: Keyboard,
    items: [
      { bindings: [['鼠标中键']], action: '关闭当前会话标签' },
      { bindings: [['Esc']], action: '关闭当前菜单或弹窗' },
    ],
  },
]

function ShortcutKeys({ bindings }: Pick<ShortcutItem, 'bindings'>) {
  return (
    <span className="shortcut-keys">
      {bindings.map((binding, bindingIndex) => (
        <span className="shortcut-key-combination" key={binding.join('-')}>
          {bindingIndex > 0 && <span className="shortcut-key-separator">/</span>}
          {binding.map((key, keyIndex) => (
            <span className="shortcut-key-part" key={key}>
              {keyIndex > 0 && <span className="shortcut-key-plus">+</span>}
              <kbd>{key}</kbd>
            </span>
          ))}
        </span>
      ))}
    </span>
  )
}

interface ShortcutGuideDialogProps {
  onClose: () => void
}

export default function ShortcutGuideDialog({ onClose }: ShortcutGuideDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop shortcut-guide-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal shortcut-guide-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-guide-title">
        <div className="modal-heading shortcut-guide-heading">
          <div>
            <div className="modal-kicker"><Keyboard size={14} /> 快捷键说明</div>
            <h2 id="shortcut-guide-title">系统快捷键</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button modal-close" title="关闭快捷键说明" aria-label="关闭快捷键说明" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="shortcut-guide-groups">
          {shortcutGroups.map(({ id, scope, icon: Icon, items }) => (
            <section className={`shortcut-guide-group shortcut-guide-group-${id}`} key={id} aria-labelledby={`shortcut-guide-${id}`}>
              <h3 id={`shortcut-guide-${id}`}><Icon size={14} /> {scope}</h3>
              <div className="shortcut-guide-table" role="table" aria-label={`${scope}快捷键`}>
                <div className="shortcut-guide-row shortcut-guide-table-header" role="row">
                  <span role="columnheader">快捷键</span>
                  <span role="columnheader">操作</span>
                </div>
                {items.map((shortcut) => (
                  <div className="shortcut-guide-row" role="row" key={shortcut.action}>
                    <span className="shortcut-guide-binding" role="cell"><ShortcutKeys bindings={shortcut.bindings} /></span>
                    <span className="shortcut-guide-action" role="cell">{shortcut.action}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  )
}
