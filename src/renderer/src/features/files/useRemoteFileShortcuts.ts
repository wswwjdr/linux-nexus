import { useEffect } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { BrowserContextMenu, SessionContextMenuState, SessionTab } from '@/app-types'

interface UseRemoteFileShortcutsOptions {
  activeSession: SessionTab | null
  activeSessionId: string | null
  modalOpen: boolean
  workspaceOpenSessionIds: Set<string>
  browserContextMenu: BrowserContextMenu | null
  sessionContextMenu: SessionContextMenuState | null
  sortedEntries: RemoteEntry[]
  canPasteRemote: boolean
  copyRemoteSelection: (entries: RemoteEntry[]) => void
  cutRemoteSelection: (entries: RemoteEntry[]) => void
  pasteRemoteEntries: () => void
}

export function useRemoteFileShortcuts({
  activeSession,
  activeSessionId,
  modalOpen,
  workspaceOpenSessionIds,
  browserContextMenu,
  sessionContextMenu,
  sortedEntries,
  canPasteRemote,
  copyRemoteSelection,
  cutRemoteSelection,
  pasteRemoteEntries,
}: UseRemoteFileShortcutsOptions) {
  useEffect(() => {
    const handleRemoteFileShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalOpen
        || (activeSessionId && workspaceOpenSessionIds.has(activeSessionId))
        || sessionContextMenu) return
      if (!activeSession || activeSession.kind !== 'files' || activeSession.status !== 'connected') return
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return

      const key = event.key.toLowerCase()
      if (browserContextMenu && key !== 'v') return

      const target = event.target
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return

      if (key === 'c' || key === 'x') {
        const selectedPaths = new Set(activeSession.selectedPaths)
        const selectedEntries = sortedEntries.filter((entry) => selectedPaths.has(entry.path)
          && (entry.type === 'file' || entry.type === 'directory'))
        if (selectedEntries.length === 0) return
        event.preventDefault()
        if (key === 'c') copyRemoteSelection(selectedEntries)
        else cutRemoteSelection(selectedEntries)
        return
      }

      if (key === 'v' && canPasteRemote) {
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
    pasteRemoteEntries,
    sessionContextMenu,
    sortedEntries,
    workspaceOpenSessionIds,
  ])
}
