import { type MessageValue, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useRef } from 'react'
import { FolderOpen, Keyboard, Terminal, X } from 'lucide-react'

interface ShortcutItem {
  bindings: MessageValue[][]
  action: MessageValue
}

interface ShortcutGroup {
  id: string
  scope: MessageValue
  icon: typeof FolderOpen
  items: ShortcutItem[]
}

const shortcutGroups: ShortcutGroup[] = [
  {
    id: 'files',
    scope: msg('common.fileManager'),
    icon: FolderOpen,
    items: [
      { bindings: [['F5']], action: msg('common.refreshCurrentDirectory') },
      { bindings: [['Ctrl', 'F']], action: msg('common.openContentSearchInTextOrReversePreview') },
      { bindings: [['Enter'], ['Shift', 'Enter']], action: msg('common.goToNextPreviousMatchInTheTextSearchBox') },
      { bindings: [['F3'], ['Shift', 'F3']], action: msg('common.goToNextPreviousMatchInTextPreview') },
      { bindings: [['Ctrl', 'A']], action: msg('common.selectAllEntriesInTheCurrentDirectory') },
      { bindings: [['Ctrl', 'C']], action: msg('common.copySelectedFilesOrFolders') },
      { bindings: [['Ctrl', 'X']], action: msg('common.cutSelectedFilesOrFolders') },
      { bindings: [['Ctrl', 'V']], action: msg('common.pasteIntoTheCurrentDirectoryOverwritingExistingFiles') },
      { bindings: [['Delete']], action: msg('common.deleteSelectedFilesOrFolders') },
      { bindings: [['Up'], ['Down'], ['Left'], ['Right']], action: msg('common.upDownMovesMenuFocusLeftRightOpensOrCloses') },
    ],
  },
  {
    id: 'ssh',
    scope: msg('settings.sshTerminal'),
    icon: Terminal,
    items: [
      { bindings: [[msg('common.rightMouseButton')]], action: msg('common.openCopyAndPasteMenu') },
      { bindings: [['Ctrl', 'Shift', 'C']], action: msg('common.copySelectedTerminalText') },
      { bindings: [['Ctrl', 'Shift', 'V']], action: msg('common.pasteSystemClipboardContent') },
    ],
  },
  {
    id: 'general',
    scope: msg('common.general'),
    icon: Keyboard,
    items: [
      { bindings: [['Ctrl', 'Shift', 'Left'], ['Ctrl', 'Shift', 'Right']], action: msg('common.moveTheFocusedSessionTabLeftOrRight') },
      { bindings: [[msg('common.middleMouseButton')]], action: msg('common.closeTheCurrentSessionTab') },
      { bindings: [['Esc']], action: msg('common.closeTheCurrentMenuOrDialog') },
    ],
  },
]

function ShortcutKeys({ bindings }: Pick<ShortcutItem, 'bindings'>) {
  useLanguage()
  return (
    <span className="shortcut-keys">
      {bindings.map((binding, bindingIndex) => (
        <span className="shortcut-key-combination" key={binding.map(renderMessage).join('-')}>
          {bindingIndex > 0 && <span className="shortcut-key-separator">/</span>}
          {binding.map((key, keyIndex) => (
            <span className="shortcut-key-part" key={renderMessage(key)}>
              {keyIndex > 0 && <span className="shortcut-key-plus">+</span>}
              <kbd>{renderMessage(key)}</kbd>
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
  useLanguage()
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
            <div className="modal-kicker"><Keyboard size={14} />{tr('common.keyboardShortcuts')}</div>
            <h2 id="shortcut-guide-title">{tr('common.systemShortcuts')}</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button modal-close" title={tr('common.closeKeyboardShortcuts')} aria-label={tr('common.closeKeyboardShortcuts')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="shortcut-guide-groups">
          {shortcutGroups.map(({ id, scope, icon: Icon, items }) => (
            <section className={`shortcut-guide-group shortcut-guide-group-${id}`} key={id} aria-labelledby={`shortcut-guide-${id}`}>
              <h3 id={`shortcut-guide-${id}`}><Icon size={14} /> {renderMessage(scope)}</h3>
              <div className="shortcut-guide-table" role="table" aria-label={tr('common.shortcuts', { "scope": scope })}>
                <div className="shortcut-guide-row shortcut-guide-table-header" role="row">
                  <span role="columnheader">{tr('previews.shortcuts')}</span>
                  <span role="columnheader">{tr('common.action')}</span>
                </div>
                {items.map((shortcut) => (
                  <div className="shortcut-guide-row" role="row" key={renderMessage(shortcut.action)}>
                    <span className="shortcut-guide-binding" role="cell"><ShortcutKeys bindings={shortcut.bindings} /></span>
                    <span className="shortcut-guide-action" role="cell">{renderMessage(shortcut.action)}</span>
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
