import { useEffect } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { BrowserContextMenu, SessionContextMenuState, SessionTab } from '@/app-types'

interface UseRemoteFileShortcutsOptions {
  activeSession: SessionTab | null
  activeSessionId: string | null
  shortcutGuideOpen: boolean
  searchOpenSessionIds: Set<string>
  setSearchOpen: (sessionId: string, open: boolean) => void
  modalOpen: boolean
  workspaceOpenSessionIds: Set<string>
  browserContextMenu: BrowserContextMenu | null
  sessionContextMenu: SessionContextMenuState | null
  sortedEntries: RemoteEntry[]
  canPasteRemote: boolean
  copyRemoteSelection: (entries: RemoteEntry[]) => void
  cutRemoteSelection: (entries: RemoteEntry[]) => void
  pasteRemoteEntries: (targetDirectory: string) => void
  openPasteStrategyMenu: () => void
}

export function useRemoteFileShortcuts({
  activeSession,
  activeSessionId,
  shortcutGuideOpen,
  searchOpenSessionIds,
  setSearchOpen,
  modalOpen,
  workspaceOpenSessionIds,
  browserContextMenu,
  sessionContextMenu,
  sortedEntries,
  canPasteRemote,
  copyRemoteSelection,
  cutRemoteSelection,
  pasteRemoteEntries,
  openPasteStrategyMenu,
}: UseRemoteFileShortcutsOptions) {
  useEffect(() => {
    const openSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      if (shortcutGuideOpen) {
        event.preventDefault()
        return
      }
      if (activeSession?.kind !== 'files' || activeSession.status !== 'connected') return
      event.preventDefault()
      if (!searchOpenSessionIds.has(activeSession.id)) setSearchOpen(activeSession.id, true)
    }
    window.addEventListener('keydown', openSearchShortcut)
    return () => window.removeEventListener('keydown', openSearchShortcut)
  }, [activeSession, searchOpenSessionIds, setSearchOpen, shortcutGuideOpen])

  useEffect(() => {
    const handleRemoteFileShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalOpen
        || (activeSessionId && workspaceOpenSessionIds.has(activeSessionId))
        || browserContextMenu || sessionContextMenu) return
      if (!activeSession || activeSession.kind !== 'files' || activeSession.status !== 'connected') return
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return

      const target = event.target
      if (target instanceof HTMLElement
        && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return

      const key = event.key.toLowerCase()
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
        openPasteStrategyMenu()
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
    openPasteStrategyMenu,
    sessionContextMenu,
    sortedEntries,
    workspaceOpenSessionIds,
  ])
}
