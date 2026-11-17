import { shortcutKeys, type KeyboardShortcut } from '@/keyboard-shortcuts'

/**
 * Renders the trailing key hint for a context menu action.
 * @param props Optional shortcut definition for the action.
 * @returns The visible hint, with accessibility handled by the action's aria-keyshortcuts.
 */
export default function ContextMenuShortcut({ shortcut }: { shortcut?: KeyboardShortcut }) {
  if (!shortcut) return null
  return <kbd className="context-menu-shortcut" aria-hidden="true">{shortcutKeys(shortcut).join('+')}</kbd>
}
