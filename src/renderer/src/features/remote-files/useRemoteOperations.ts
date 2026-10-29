import { useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react'
import type {
  OperationExecutionRequest,
  OperationExecutionStrategy,
  OperationStrategy,
  RemoteOperationConfirmation,
  RemoteOperationIntent,
  RemoteOperationKind,
  RemoteEntry,
  ServerProfile,
} from '@shared/types'
import type { BrowserContextMenu, SessionTab } from '@/app-types'
import { errorMessage, getParentPath } from '@/app-utils'

interface ActiveOperation {
  requestId: string
  sessionId: string
  operation: RemoteOperationKind
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  profile: Pick<ServerProfile, 'id' | 'host' | 'port' | 'username'>
  sourcePaths: string[]
}

interface RemoteEntryDeleteDialog {
  entries: RemoteEntry[]
  sessionId: string
  directory: string
}

export interface ArchiveDestinationDialogState {
  sessionId: string
  entry: Pick<RemoteEntry, 'name' | 'path'>
  directory: string
  strategy: OperationStrategy
}

interface UseRemoteOperationsOptions {
  activeSession: SessionTab | null
  connectedProfile: ServerProfile | null
  connectedSessionId: string | null
  currentPath: string
  sessionsRef: MutableRefObject<SessionTab[]>
  patchSession: (sessionId: string, patch: Partial<SessionTab>) => void
  updateSession: (sessionId: string, update: (session: SessionTab) => SessionTab) => void
  loadDirectory: (sessionId: string, remotePath: string) => Promise<boolean>
  showToast: (kind: 'info' | 'error', message: string, action?: { label: string; onClick: () => void }) => void
  setBrowserContextMenu: Dispatch<SetStateAction<BrowserContextMenu | null>>
}

export function useRemoteOperations({
  activeSession,
  connectedProfile,
  connectedSessionId,
  currentPath,
  sessionsRef,
  patchSession,
  updateSession,
  loadDirectory,
  showToast,
  setBrowserContextMenu,
}: UseRemoteOperationsOptions) {
  const [remoteEntryDeleteDialog, setRemoteEntryDeleteDialog] = useState<RemoteEntryDeleteDialog | null>(null)
  const [remoteEntryDeleteError, setRemoteEntryDeleteError] = useState<string | null>(null)
  const [remoteEntryDeleting, setRemoteEntryDeleting] = useState(false)
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [operationConfirmation, setOperationConfirmation] = useState<RemoteOperationConfirmation | null>(null)
  const [activeOperation, setActiveOperation] = useState<ActiveOperation | null>(null)
  const [operationBusy, setOperationBusy] = useState(false)
  const [createDirectoryDialog, setCreateDirectoryDialog] = useState<{ name: string } | null>(null)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [archiveDestinationDialog, setArchiveDestinationDialog] = useState<ArchiveDestinationDialogState | null>(null)

  const clipboardMatchesProfile = Boolean(remoteClipboard && connectedProfile
    && remoteClipboard.profile.id === connectedProfile.id
    && remoteClipboard.profile.host === connectedProfile.host
    && remoteClipboard.profile.port === connectedProfile.port
    && remoteClipboard.profile.username === connectedProfile.username)
  const canPasteRemote = Boolean(clipboardMatchesProfile && activeSession?.kind === 'files'
    && activeSession.status === 'connected' && !activeOperation && !operationConfirmation)

  const setRemoteSelectionClipboard = (selectedEntries: RemoteEntry[], mode: RemoteClipboard['mode']) => {
    if (!connectedProfile || !connectedSessionId || selectedEntries.length === 0) return
    setRemoteClipboard({
      mode,
      profile: {
        id: connectedProfile.id,
        host: connectedProfile.host,
        port: connectedProfile.port,
        username: connectedProfile.username,
      },
      sourcePaths: selectedEntries.map((entry) => entry.path),
    })
    setBrowserContextMenu(null)
    showToast('info', `已${mode === 'copy' ? '复制' : '剪切'} ${selectedEntries.length} 项，可粘贴到目标目录`)
  }

  const copyRemoteSelection = (selectedEntries: RemoteEntry[]) => setRemoteSelectionClipboard(selectedEntries, 'copy')
  const cutRemoteSelection = (selectedEntries: RemoteEntry[]) => setRemoteSelectionClipboard(selectedEntries, 'cut')

  const submitCreateDirectory = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!connectedSessionId || !createDirectoryDialog) return
    const sessionId = connectedSessionId
    const directory = currentPath
    const { name } = createDirectoryDialog
    setCreatingDirectory(true)
    try {
      await window.remoteFiles.createRemoteDirectory(sessionId, directory, name)
      setCreateDirectoryDialog(null)
      if (await loadDirectory(sessionId, directory)) showToast('info', '文件夹已创建')
    } catch (error) {
      showToast('error', `创建失败：${errorMessage(error)}`)
    } finally {
      setCreatingDirectory(false)
    }
  }

  const startArchiveExtraction = (
    entry: Pick<RemoteEntry, 'name' | 'path'>,
    sessionId: string,
    targetDirectory: string,
    wrapInDirectory: boolean,
    strategy: OperationStrategy,
  ) => {
    setArchiveDestinationDialog(null)
    void startRemoteOperation('extract', [], targetDirectory, strategy, {
      archivePath: entry.path,
      wrapInDirectory,
      sessionId,
    })
  }

  const extractRemoteArchive = (
    entry: Pick<RemoteEntry, 'name' | 'path'>,
    target: 'current-directory' | 'archive-directory' | 'choose-directory',
    activeDirectory: string,
    strategy: OperationStrategy,
  ) => {
    const session = activeSession
    if (!session || session.kind !== 'files' || session.status !== 'connected' || activeOperation || operationConfirmation) return
    setBrowserContextMenu(null)
    if (target === 'choose-directory') {
      setArchiveDestinationDialog({ sessionId: session.id, entry, directory: activeDirectory, strategy })
      return
    }
    startArchiveExtraction(entry, session.id, activeDirectory, target === 'archive-directory', strategy)
  }

  const beginArchiveExtractionAt = (targetDirectory: string) => {
    const dialog = archiveDestinationDialog
    if (!dialog) return
    startArchiveExtraction(dialog.entry, dialog.sessionId, targetDirectory, false, dialog.strategy)
  }

  const createArchiveDestinationDirectory = async (directory: string, name: string) => {
    const dialog = archiveDestinationDialog
    if (!dialog) return
    await window.remoteFiles.createRemoteDirectory(dialog.sessionId, directory, name)
  }

  const requestRemoteEntriesDeletion = (entries: RemoteEntry[]) => {
    if (entries.length === 0 || !connectedSessionId) return
    setBrowserContextMenu(null)
    setRemoteEntryDeleteError(null)
    setRemoteEntryDeleteDialog({ entries, sessionId: connectedSessionId, directory: currentPath })
  }

  const cancelRemoteEntryDeletion = () => {
    if (remoteEntryDeleting) return
    setRemoteEntryDeleteDialog(null)
    setRemoteEntryDeleteError(null)
  }

  const confirmRemoteEntryDeletion = async () => {
    if (!remoteEntryDeleteDialog || remoteEntryDeleting) return
    const { entries, sessionId, directory } = remoteEntryDeleteDialog
    setRemoteEntryDeleting(true)
    setRemoteEntryDeleteError(null)
    try {
      await window.remoteFiles.deleteRemoteEntries(sessionId, entries.map((entry) => entry.path))
    } catch (error) {
      setRemoteEntryDeleteError(errorMessage(error))
      setRemoteEntryDeleting(false)
      return
    } finally {
      setRemoteEntryDeleting(false)
    }

    {
      const deletedPaths = new Set(entries.map((entry) => entry.path))
      updateSession(sessionId, (session) => ({
        ...session,
        entries: session.entries.filter((item) => !deletedPaths.has(item.path)),
      }))
      await loadDirectory(sessionId, directory)
    }

    setRemoteEntryDeleteDialog(null)
    setRemoteEntryDeleteError(null)
    showToast('info', `已删除 ${entries.length} 项`)
  }

  const startRemoteOperation = async (
    operation: RemoteOperationKind,
    sourcePaths: string[],
    targetDirectory: string,
    strategy: OperationStrategy,
    extra?: { archivePath?: string; wrapInDirectory?: boolean; sessionId?: string },
  ) => {
    const sessionId = extra?.sessionId ?? activeSession?.id
    const session = sessionId ? sessionsRef.current.find((candidate) => candidate.id === sessionId) : null
    if (!session || session.kind !== 'files' || session.status !== 'connected'
      || activeOperation || operationConfirmation) return
    setBrowserContextMenu(null)
    try {
      const operationRequest: RemoteOperationIntent = {
        requestId: window.crypto.randomUUID(),
        sessionId: session.id,
        operation,
        sourcePaths: [...sourcePaths],
        targetDirectory,
        strategy,
        ...(extra?.archivePath ? { archivePath: extra.archivePath, wrapInDirectory: extra.wrapInDirectory } : {}),
      }
      const confirmation = await window.remoteFiles.composeOperation(operationRequest)
      setOperationConfirmation(confirmation)
    } catch (error) {
      const label = operation === 'copy' ? '复制' : operation === 'move' ? '移动' : '解压'
      showToast('error', `${label}命令生成失败：${errorMessage(error)}`)
    }
  }

  const beginRemoteCopy = (targetDirectory: string, strategy: OperationStrategy = 'confirm') => {
    if (!remoteClipboard || remoteClipboard.mode !== 'copy' || !canPasteRemote) return
    void startRemoteOperation('copy', remoteClipboard.sourcePaths, targetDirectory, strategy)
  }

  const beginRemoteMove = (sourcePaths: string[], targetDirectory: string, strategy: OperationStrategy = 'confirm') => {
    void startRemoteOperation('move', sourcePaths, targetDirectory, strategy)
  }

  const pasteRemoteEntries = (targetDirectory: string, strategy: OperationStrategy = 'confirm') => {
    if (!remoteClipboard || !canPasteRemote) return
    const operation = remoteClipboard.mode === 'cut' ? 'move' : 'copy'
    void startRemoteOperation(operation, remoteClipboard.sourcePaths, targetDirectory, strategy)
  }

  const confirmRemoteOperation = async (strategy: OperationExecutionStrategy) => {
    const confirmation = operationConfirmation
    if (!confirmation || operationBusy) return
    setOperationBusy(true)
    setActiveOperation({ requestId: confirmation.requestId, sessionId: confirmation.sessionId, operation: confirmation.operation })
    const label = confirmation.operation === 'copy' ? '复制' : confirmation.operation === 'move' ? '移动' : '解压'
    try {
      const request: OperationExecutionRequest = {
        requestId: confirmation.requestId,
        sessionId: confirmation.sessionId,
        operation: confirmation.operation,
        sourcePaths: confirmation.sourcePaths,
        targetDirectory: confirmation.targetDirectory,
        strategy,
        ...(confirmation.archivePath ? { archivePath: confirmation.archivePath } : {}),
        ...(confirmation.wrapInDirectory !== undefined ? { wrapInDirectory: confirmation.wrapInDirectory } : {}),
      }
      const result = await window.remoteFiles.executeOperation(request)
      showToast('info', result.status === 'cancelled' ? `${label}已取消` : `${label}命令已完成`)
      if (result.status === 'completed' && confirmation.operation === 'move') {
        setRemoteClipboard((current) => current?.mode === 'cut'
          && current.sourcePaths.length === confirmation.sourcePaths.length
          && current.sourcePaths.every((path, index) => path === confirmation.sourcePaths[index]) ? null : current)
      }
    } catch (error) {
      showToast('error', `${label}失败：${errorMessage(error)}`)
    } finally {
      setOperationBusy(false)
      setActiveOperation(null)
      setOperationConfirmation(null)
      const affectedDirectories = new Set([
        ...confirmation.sourcePaths.map(getParentPath),
        confirmation.targetDirectory,
        ...(confirmation.outputDirectory ? [confirmation.outputDirectory] : []),
      ])
      const session = sessionsRef.current.find((candidate) => candidate.id === confirmation.sessionId)
      const refreshSessions = sessionsRef.current.filter((candidate) => candidate.profileId === session?.profileId
        && candidate.kind === 'files' && candidate.status === 'connected'
        && [...affectedDirectories].some((directory) => candidate.currentPath === directory
          || candidate.currentPath.startsWith(directory === '/' ? '/' : directory + '/')))
      await Promise.all(refreshSessions.map((candidate) => loadDirectory(candidate.id, candidate.currentPath)))
    }
  }

  const cancelActiveOperation = () => {
    if (activeOperation) {
      void window.remoteFiles.cancelOperation(activeOperation.requestId).catch((error) => showToast('error', `取消操作失败：${errorMessage(error)}`))
      return
    }
    if (operationConfirmation) setOperationConfirmation(null)
  }

  return {
    operationConfirmation,
    activeOperation,
    operationBusy,
    canPasteRemote,
    remoteClipboard,
    remoteEntryDeleteDialog,
    remoteEntryDeleteError,
    remoteEntryDeleting,
    createDirectoryDialog,
    setCreateDirectoryDialog,
    creatingDirectory,
    archiveDestinationDialog,
    submitCreateDirectory,
    extractRemoteArchive,
    beginArchiveExtractionAt,
    createArchiveDestinationDirectory,
    setArchiveDestinationDialog,
    requestRemoteEntriesDeletion,
    cancelRemoteEntryDeletion,
    confirmRemoteEntryDeletion,
    copyRemoteSelection,
    cutRemoteSelection,
    beginRemoteCopy,
    beginRemoteMove,
    pasteRemoteEntries,
    confirmRemoteOperation,
    cancelActiveOperation,
  }
}
