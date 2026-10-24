import type { Dispatch, SetStateAction } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { BrowserContextMenu, SessionTab } from '../../app-types'
import type { SessionPreviewActions } from './SftpSessionWorkspace'
import type { SftpContextMenuContext, SftpMenuAction } from './sftp-menu'
import type { ToastNotice } from '../../GlobalToast'
import type { useRemoteOperations } from '../remote-files/useRemoteOperations'
import type { useSessionOperations } from '../sessions/useSessionOperations'
import type { useTransfers } from '../../hooks/useTransfers'
import type { useScriptExecution } from './useScriptExecution'
import { errorMessage } from '../../app-utils'

type RemoteOperations = ReturnType<typeof useRemoteOperations>
type SessionOperations = ReturnType<typeof useSessionOperations>
type TransferOperations = ReturnType<typeof useTransfers>
type ScriptExecution = ReturnType<typeof useScriptExecution>

interface UseSftpMenuActionsOptions {
  activeSession: SessionTab | null
  connectedSessionId: string | null
  currentPath: string
  sort: SessionTab['sort']
  canPasteRemote: boolean
  setBrowserContextMenu: Dispatch<SetStateAction<BrowserContextMenu | null>>
  setSessionContextMenu: Dispatch<SetStateAction<{ sessionId: string; x: number; y: number } | null>>
  contextMenuAnchorRef: { current: HTMLElement | null }
  setSearchOpen: (sessionId: string, open: boolean) => void
  previewActionsRef: { current: Map<string, SessionPreviewActions> }
  scriptExecution: Pick<ScriptExecution, 'runScript' | 'requestScriptCommandEdit'>
  transfers: Pick<TransferOperations, 'download' | 'uploadFiles'>
  remoteOperations: Pick<RemoteOperations,
    'copyRemoteSelection' | 'cutRemoteSelection' | 'pasteRemoteEntries' | 'requestRemoteEntriesDeletion' | 'setCreateDirectoryDialog'>
  locateSearchResult: SessionOperations['locateSearchResult']
  patchSession: (sessionId: string, patch: Partial<SessionTab>) => void
  showToast: (kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => void
}

export function useSftpMenuActions({
  activeSession,
  connectedSessionId,
  currentPath,
  sort,
  canPasteRemote,
  setBrowserContextMenu,
  setSessionContextMenu,
  contextMenuAnchorRef,
  setSearchOpen,
  previewActionsRef,
  scriptExecution,
  transfers,
  remoteOperations,
  locateSearchResult,
  patchSession,
  showToast,
}: UseSftpMenuActionsOptions) {
  const openBrowserContextMenu = (menu: BrowserContextMenu) => {
    setSessionContextMenu(null)
    contextMenuAnchorRef.current = menu.anchor
    setBrowserContextMenu({ ...menu, x: Math.max(8, menu.x), y: Math.max(8, menu.y) })
  }

  const openEntryContextMenu = (entries: RemoteEntry[], x: number, y: number, anchor: HTMLElement) => {
    if (entries.length === 0) return
    openBrowserContextMenu(entries.length === 1
      ? { kind: 'single-entry', entry: entries[0], canPaste: canPasteRemote, x, y, anchor }
      : { kind: 'multiple-entries', entries: [...entries], canPaste: canPasteRemote, x, y, anchor })
  }

  const openDirectoryContextMenu = (x: number, y: number, anchor: HTMLElement) => {
    openBrowserContextMenu({
      kind: 'directory-background',
      directory: currentPath,
      canPaste: canPasteRemote,
      sort,
      x,
      y,
      anchor,
    })
  }

  const copyPath = async (remotePath: string) => {
    if (!connectedSessionId) return
    setBrowserContextMenu(null)
    try {
      await window.remoteFiles.copyRemotePath(connectedSessionId, remotePath)
      showToast('info', '路径已复制')
    } catch (error) {
      showToast('error', `复制路径失败：${errorMessage(error)}`)
    }
  }

  const dispatchSftpMenuAction = (action: SftpMenuAction, context: SftpContextMenuContext, sessionId: string) => {
    setBrowserContextMenu(null)
    if (context.kind === 'search-result'
      && (action.type === 'run-script' || action.type === 'adjust-script-command')) setSearchOpen(sessionId, false)
    const entry = context.kind === 'single-entry' ? context.entry
      : context.kind === 'search-result' ? context.result
        : null
    const entries = context.kind === 'single-entry' ? [context.entry]
      : context.kind === 'multiple-entries' ? context.entries
        : null
    switch (action.type) {
      case 'preview':
        if (entry) void previewActionsRef.current.get(sessionId)?.previewFile(entry, action.previewType)
        break
      case 'preview-log':
        if (entry) void previewActionsRef.current.get(sessionId)?.previewLogFile(entry)
        break
      case 'run-script':
        if (entry) scriptExecution.runScript(entry, sessionId)
        break
      case 'adjust-script-command':
        if (entry) scriptExecution.requestScriptCommandEdit(entry, sessionId)
        break
      case 'download':
        if (entries) transfers.download(entries)
        break
      case 'copy':
        if (entries) remoteOperations.copyRemoteSelection(entries)
        break
      case 'cut':
        if (entries) remoteOperations.cutRemoteSelection(entries)
        break
      case 'paste':
        if (context.kind === 'directory-background') remoteOperations.pasteRemoteEntries(context.directory)
        else if (context.kind === 'single-entry' && context.entry.type === 'directory') remoteOperations.pasteRemoteEntries(context.entry.path)
        else remoteOperations.pasteRemoteEntries(currentPath)
        break
      case 'copy-path':
        if (context.kind === 'single-entry') void copyPath(context.entry.path)
        else if (context.kind === 'directory-background') void copyPath(context.directory)
        break
      case 'delete':
        if (entries) remoteOperations.requestRemoteEntriesDeletion(entries)
        break
      case 'sort-column':
        if (context.kind === 'directory-background' && activeSession?.kind === 'sftp') {
          patchSession(activeSession.id, { sort: { ...context.sort, column: action.column } })
        }
        break
      case 'sort-direction':
        if (context.kind === 'directory-background' && activeSession?.kind === 'sftp') {
          patchSession(activeSession.id, { sort: { ...context.sort, direction: action.direction } })
        }
        break
      case 'create-directory':
        remoteOperations.setCreateDirectoryDialog({ name: '' })
        break
      case 'upload':
        void transfers.uploadFiles()
        break
      case 'open-location':
        if (context.kind === 'search-result') void locateSearchResult(context.result, sessionId)
        break
    }
  }

  return { openEntryContextMenu, openDirectoryContextMenu, dispatchSftpMenuAction }
}
