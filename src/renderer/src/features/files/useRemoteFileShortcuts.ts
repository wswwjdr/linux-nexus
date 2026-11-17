import { useEffect } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { BrowserContextMenu, SessionContextMenuState, SessionTab } from '@/app-types'
import { fileShortcuts, matchesShortcut } from '@/keyboard-shortcuts'

interface UseRemoteFileShortcutsOptions {
  activeSession: SessionTab | null
  activeSessionId: string | null
  modalOpen: boolean
  workspaceOpenSessionIds: Set<string>
  browserContextMenu: BrowserContextMenu | null
  sessionContextMenu: SessionContextMenuState | null
  sortedEntries: RemoteEntry[]
  canPasteRemote: boolean
  onRefresh: () => void
  onSelectedPathsChange: (paths: string[]) => void
  copyRemoteSelection: (entries: RemoteEntry[]) => void
  cutRemoteSelection: (entries: RemoteEntry[]) => void
  pasteRemoteEntries: () => void
}

/**
 * Registers keyboard commands for the active file session.
 * @param options Session state and callbacks that implement the file commands.
 */
export function useRemoteFileShortcuts({
  activeSession,
  activeSessionId,
  modalOpen,
  workspaceOpenSessionIds,
  browserContextMenu,
  sessionContextMenu,
  sortedEntries,
  canPasteRemote,
  onRefresh,
  onSelectedPathsChange,
  copyRemoteSelection,
  cutRemoteSelection,
  pasteRemoteEntries,
}: UseRemoteFileShortcutsOptions) {
  useEffect(() => {
    /**
     * Dispatches a file command when the active workspace can handle the pressed shortcut.
     * @param event Keyboard event from the renderer window.
     */
    const handleRemoteFileShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalOpen
        || (activeSessionId && workspaceOpenSessionIds.has(activeSessionId))
        || sessionContextMenu) return
      if (!activeSession || activeSession.kind !== 'files' || activeSession.status !== 'connected') return

      if (event.key === 'F5' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        if (!activeSession.loading && !event.repeat && !browserContextMenu) onRefresh()
        return
      }

      const paste = matchesShortcut(event, fileShortcuts.paste)
      if (browserContextMenu && !paste) return

      const target = event.target
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return

      if (matchesShortcut(event, fileShortcuts.selectAll)) {
        event.preventDefault()
        onSelectedPathsChange(sortedEntries.map((entry) => entry.path))
        return
      }

      const copy = matchesShortcut(event, fileShortcuts.copy)
      if (copy || matchesShortcut(event, fileShortcuts.cut)) {
        const selectedPaths = new Set(activeSession.selectedPaths)
        const selectedEntries = sortedEntries.filter((entry) => selectedPaths.has(entry.path)
          && (entry.type === 'file' || entry.type === 'directory'))
        if (selectedEntries.length === 0) return
        event.preventDefault()
        if (copy) copyRemoteSelection(selectedEntries)
        else cutRemoteSelection(selectedEntries)
        return
      }

      if (paste && canPasteRemote) {
        event.preventDefault()
        pasteRemoteEntries()
      }
    }

    window.addEventListener('keydown', handleRemoteFileShortcut)
    return () => window.removeEventListener('keydown', handleRemoteFileShortcut)
  }, [
    activeSession,
    activeSessionId,
    browserContextMenu,
    canPasteRemote,
    copyRemoteSelection,
    cutRemoteSelection,
    modalOpen,
    onRefresh,
    onSelectedPathsChange,
    pasteRemoteEntries,
    sessionContextMenu,
    sortedEntries,
    workspaceOpenSessionIds,
  ])
}
