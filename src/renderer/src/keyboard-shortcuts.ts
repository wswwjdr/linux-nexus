export interface KeyboardShortcut {
  key: string
  modifiers?: 'primary' | 'ctrl-shift'
  allowExtraModifiers?: boolean
}

export const fileShortcuts = {
  selectAll: { key: 'A', modifiers: 'primary' },
  copy: { key: 'C', modifiers: 'primary' },
  cut: { key: 'X', modifiers: 'primary' },
  paste: { key: 'V', modifiers: 'primary' },
  delete: { key: 'Delete', allowExtraModifiers: true },
} as const satisfies Record<string, KeyboardShortcut>

export const terminalShortcuts = {
  copy: { key: 'C', modifiers: 'ctrl-shift', allowExtraModifiers: true },
  paste: { key: 'V', modifiers: 'ctrl-shift' },
} as const satisfies Record<string, KeyboardShortcut>

type ShortcutEvent = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/**
 * Checks whether a keyboard event activates the supplied shortcut.
 * @param event Keyboard event and its pressed modifiers.
 * @param shortcut Binding to match, including the existing modifier rules for that action.
 * @returns Whether the key and modifiers match.
 */
export function matchesShortcut(event: ShortcutEvent, shortcut: KeyboardShortcut): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false
  if (shortcut.modifiers === 'primary') return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey
  if (shortcut.modifiers === 'ctrl-shift') {
    return event.ctrlKey && event.shiftKey && (shortcut.allowExtraModifiers || (!event.altKey && !event.metaKey))
  }
  return shortcut.allowExtraModifiers || (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey)
}

/**
 * Lists the keys of a shortcut in Windows display order.
 * @param shortcut Binding to describe.
 * @returns Individual key labels for the shortcut guide and context menu.
 */
export function shortcutKeys(shortcut: KeyboardShortcut): string[] {
  switch (shortcut.modifiers) {
    case 'primary': return ['Ctrl', shortcut.key]
    case 'ctrl-shift': return ['Ctrl', 'Shift', shortcut.key]
    default: return [shortcut.key]
  }
}

/**
 * Formats a binding for the aria-keyshortcuts attribute.
 * @param shortcut Optional binding for the action.
 * @returns The ARIA key combination, or undefined if the action has no shortcut.
 */
export function ariaKeyShortcut(shortcut: KeyboardShortcut | undefined): string | undefined {
  return shortcut && shortcutKeys(shortcut).map((key) => key === 'Ctrl' ? 'Control' : key).join('+')
}
