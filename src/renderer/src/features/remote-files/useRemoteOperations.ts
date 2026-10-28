import { useEffect, useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react'
import type {
  RemoteCopyConflict,
  RemoteCopyDecision,
  RemoteCopyEvent,
  RemoteCopyResult,
  RemoteEntry,
  RemoteArchiveConflict,
  RemoteArchiveDecision,
  RemoteArchiveEvent,
  RemoteArchiveProgress,
  RemoteArchiveResult,
  RemoteMoveConflict,
  RemoteMoveDecision,
  RemoteMoveProgress,
  RemoteMoveResult,
  ServerProfile,
} from '@shared/types'
import type { BrowserContextMenu, SessionTab } from '@/app-types'
import { errorMessage, getParentPath } from '@/app-utils'

interface ActiveRemoteMove {
  requestId: string
  sessionId: string
  progress: RemoteMoveProgress
  conflict: RemoteMoveConflict | null
  decisionPending: boolean
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  profile: Pick<ServerProfile, 'id' | 'host' | 'port' | 'username'>
  sourcePaths: string[]
}

interface ActiveRemoteCopy {
  requestId: string
  sessionId: string
  targetDirectory: string
  conflict: RemoteCopyConflict | null
  decisionPending: boolean
}

interface RemoteOperationSummary {
  operation: 'move' | 'copy'
  result: RemoteMoveResult | RemoteCopyResult
}

interface RemoteEntryDeleteDialog {
  entries: RemoteEntry[]
  sessionId: string
  directory: string
}

export interface ActiveArchiveExtraction {
  requestId: string
  sessionId: string
  name: string
  path: string
  targetDirectory: string
  wrapInDirectory: boolean
  progress: RemoteArchiveProgress
  conflict: RemoteArchiveConflict | null
  decisionPending: boolean
}

export interface ArchiveDestinationDialogState {
  sessionId: string
  entry: Pick<RemoteEntry, 'name' | 'path'>
  directory: string
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
  const [activeRemoteMove, setActiveRemoteMove] = useState<ActiveRemoteMove | null>(null)
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [activeRemoteCopy, setActiveRemoteCopy] = useState<ActiveRemoteCopy | null>(null)
  const [remoteOperationSummary, setRemoteOperationSummary] = useState<RemoteOperationSummary | null>(null)
  const [remoteOperationDetailsOpen, setRemoteOperationDetailsOpen] = useState(false)
  const [createDirectoryDialog, setCreateDirectoryDialog] = useState<{ name: string } | null>(null)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [activeArchiveExtraction, setActiveArchiveExtraction] = useState<ActiveArchiveExtraction | null>(null)
  const [archiveDestinationDialog, setArchiveDestinationDialog] = useState<ArchiveDestinationDialogState | null>(null)
  const [archiveSummary, setArchiveSummary] = useState<RemoteArchiveResult | null>(null)

  useEffect(() => window.remoteFiles.onRemoteArchiveEvent((event: RemoteArchiveEvent) => {
    if (event.type === 'conflict') {
      setActiveArchiveExtraction((current) => current?.requestId === event.conflict.requestId
        ? { ...current, conflict: event.conflict, decisionPending: false }
        : current)
      return
    }
    setActiveArchiveExtraction((current) => current?.requestId === event.progress.requestId
      ? { ...current, progress: event.progress }
      : current)
  }), [])

  useEffect(() => window.remoteFiles.onRemoteMoveEvent((event) => {
    if (event.type === 'conflict') {
      setActiveRemoteMove((current) => current?.requestId === event.conflict.requestId
        ? { ...current, conflict: event.conflict, decisionPending: false }
        : current)
      return
    }
    setActiveRemoteMove((current) => current?.requestId === event.progress.requestId
      ? { ...current, progress: event.progress }
      : current)
  }), [])

  useEffect(() => window.remoteFiles.onRemoteCopyEvent((event: RemoteCopyEvent) => {
    if (event.type !== 'conflict') return
    setActiveRemoteCopy((current) => current?.requestId === event.conflict.requestId
      ? { ...current, conflict: event.conflict, decisionPending: false }
      : current)
  }), [])

  const clipboardMatchesProfile = Boolean(remoteClipboard && connectedProfile
    && remoteClipboard.profile.id === connectedProfile.id
    && remoteClipboard.profile.host === connectedProfile.host
    && remoteClipboard.profile.port === connectedProfile.port
    && remoteClipboard.profile.username === connectedProfile.username)
  const canPasteRemote = Boolean(clipboardMatchesProfile && activeSession?.kind === 'sftp'
    && activeSession.status === 'connected' && !activeRemoteCopy && !activeRemoteMove)

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

  const startArchiveExtraction = (entry: Pick<RemoteEntry, 'name' | 'path'>, sessionId: string, targetDirectory: string, wrapInDirectory: boolean) => {
    if (activeArchiveExtraction) return
    const profileId = sessionsRef.current.find((candidate) => candidate.id === sessionId)?.profileId
    const requestId = window.crypto.randomUUID()
    const extraction: ActiveArchiveExtraction = {
      requestId,
      sessionId,
      name: entry.name,
      path: entry.path,
      targetDirectory,
      wrapInDirectory,
      progress: { requestId, sessionId, phase: 'preparing', completedCount: 0, totalCount: 0, currentPath: null },
      conflict: null,
      decisionPending: false,
    }
    setArchiveDestinationDialog(null)
    setArchiveSummary(null)
    setActiveArchiveExtraction(extraction)
    setBrowserContextMenu(null)
    void (async () => {
      let outputDirectory = targetDirectory
      try {
        const result = await window.remoteFiles.startRemoteArchiveExtraction({
          requestId,
          sessionId,
          archivePath: entry.path,
          targetDirectory,
          wrapInDirectory,
        })
        outputDirectory = result.outputDirectory
        setArchiveSummary(result)
      } catch (error) {
        showToast('error', `解压失败：${errorMessage(error)}`)
      } finally {
        setActiveArchiveExtraction((current) => current?.requestId === requestId ? null : current)
        const sessionsToRefresh = sessionsRef.current.filter((candidate) => candidate.profileId === profileId
          && candidate.kind === 'sftp' && candidate.status === 'connected'
          && (candidate.currentPath === targetDirectory
            || candidate.currentPath.startsWith(targetDirectory === '/' ? '/' : targetDirectory + '/')))
        await Promise.all(sessionsToRefresh.map((candidate) => loadDirectory(candidate.id, candidate.currentPath)))
      }
    })()
  }

  const extractRemoteArchive = (
    entry: Pick<RemoteEntry, 'name' | 'path'>,
    target: 'current-directory' | 'archive-directory' | 'choose-directory',
    activeDirectory: string,
  ) => {
    const session = activeSession
    if (!session || session.kind !== 'sftp' || session.status !== 'connected' || activeArchiveExtraction) return
    setBrowserContextMenu(null)
    if (target === 'choose-directory') {
      setArchiveDestinationDialog({ sessionId: session.id, entry, directory: activeDirectory })
      return
    }
    startArchiveExtraction(entry, session.id, activeDirectory, target === 'archive-directory')
  }

  const beginArchiveExtractionAt = (targetDirectory: string) => {
    const dialog = archiveDestinationDialog
    if (!dialog) return
    startArchiveExtraction(dialog.entry, dialog.sessionId, targetDirectory, false)
  }

  const decideRemoteArchiveConflict = async (decision: RemoteArchiveDecision) => {
    const extraction = activeArchiveExtraction
    const conflict = extraction?.conflict
    if (!extraction || !conflict || extraction.decisionPending) return
    setActiveArchiveExtraction((current) => current?.requestId === extraction.requestId
      ? { ...current, decisionPending: true }
      : current)
    try {
      const accepted = await window.remoteFiles.decideRemoteArchiveExtraction(extraction.requestId, conflict.conflictId, decision)
      if (!accepted) throw new Error('解压冲突已失效，请重试')
      setActiveArchiveExtraction((current) => current?.requestId === extraction.requestId && current.conflict?.conflictId === conflict.conflictId
        ? { ...current, conflict: null, decisionPending: false }
        : current)
    } catch (error) {
      showToast('error', `提交解压决策失败：${errorMessage(error)}`)
      setActiveArchiveExtraction((current) => current?.requestId === extraction.requestId
        ? { ...current, decisionPending: false }
        : current)
    }
  }

  const cancelActiveArchiveExtraction = () => {
    const extraction = activeArchiveExtraction
    if (!extraction) return
    void window.remoteFiles.cancelRemoteArchiveExtraction(extraction.requestId).then((cancelled) => {
      if (!cancelled) showToast('info', '解压任务已结束')
    }).catch((error) => showToast('error', `取消解压失败：${errorMessage(error)}`))
  }

  const closeArchiveSummary = () => setArchiveSummary(null)

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
    const deleted: RemoteEntry[] = []
    const failed: { entry: RemoteEntry; error: string }[] = []
    try {
      for (const entry of entries) {
        try {
          await window.remoteFiles.deleteRemoteEntry(sessionId, entry.path)
          deleted.push(entry)
        } catch (error) {
          failed.push({ entry, error: errorMessage(error) })
        }
      }
    } finally {
      setRemoteEntryDeleting(false)
    }

    if (deleted.length > 0) {
      const deletedPaths = new Set(deleted.map((entry) => entry.path))
      updateSession(sessionId, (session) => ({
        ...session,
        entries: session.entries.filter((item) => !deletedPaths.has(item.path)),
      }))
      await loadDirectory(sessionId, directory)
    }

    setRemoteEntryDeleteDialog(failed.length > 0
      ? { entries: failed.map(({ entry }) => entry), sessionId, directory }
      : null)
    setRemoteEntryDeleteError(failed.length > 0
      ? failed.map(({ entry, error }) => `${entry.name}: ${error}`).join('；')
      : null)
    if (deleted.length > 0) showToast('info', `已删除 ${deleted.length} 项`)
  }

  const showRemoteOperationResult = (operation: 'move' | 'copy', result: RemoteMoveResult | RemoteCopyResult) => {
    const label = operation === 'copy' ? '复制' : '移动'
    const completedCount = operation === 'copy'
      ? (result as RemoteCopyResult).copiedCount
      : (result as RemoteMoveResult).movedCount
    const status = result.status === 'cancelled' ? '已取消' : '已完成'
    const counts = `已${label} ${completedCount} 项，跳过 ${result.skippedCount} 项，失败 ${result.failedCount} 项`
      + (result.cancelledCount > 0 ? `，未完成 ${result.cancelledCount} 项` : '')
    setRemoteOperationSummary({ operation, result })
    setRemoteOperationDetailsOpen(false)
    showToast('info', `远程${label}${status}：${counts}`, result.failedCount > 0
      ? { label: `查看${label}详情`, onClick: () => setRemoteOperationDetailsOpen(true) }
      : undefined)
  }

  const beginRemoteCopy = (targetDirectory: string) => {
    const session = activeSession
    const clipboard = remoteClipboard
    if (!session || session.kind !== 'sftp' || session.status !== 'connected'
      || !clipboard || !canPasteRemote || activeRemoteCopy || activeRemoteMove) return
    const requestId = window.crypto.randomUUID()
    const sourcePaths = [...clipboard.sourcePaths]
    setBrowserContextMenu(null)
    setActiveRemoteCopy({ requestId, sessionId: session.id, targetDirectory, conflict: null, decisionPending: false })
    void (async () => {
      try {
        const result = await window.remoteFiles.copyRemoteEntries({ requestId, sessionId: session.id, sourcePaths, targetDirectory })
        showRemoteOperationResult('copy', result)
      } catch (error) {
        showToast('error', `复制失败：${errorMessage(error)}`)
      } finally {
        setActiveRemoteCopy((current) => current?.requestId === requestId ? null : current)
        if (sessionsRef.current.some((candidate) => candidate.id === session.id
          && candidate.status === 'connected' && candidate.currentPath === targetDirectory)) {
          await loadDirectory(session.id, targetDirectory)
        }
      }
    })()
  }

  const decideRemoteCopyConflict = async (decision: RemoteCopyDecision) => {
    const copy = activeRemoteCopy
    const conflict = copy?.conflict
    if (!copy || !conflict || copy.decisionPending) return
    setActiveRemoteCopy((current) => current?.requestId === copy.requestId
      ? { ...current, decisionPending: true }
      : current)
    try {
      const accepted = await window.remoteFiles.decideRemoteCopy(copy.requestId, conflict.conflictId, decision)
      if (!accepted) throw new Error('复制冲突已失效，请重试')
      setActiveRemoteCopy((current) => current?.requestId === copy.requestId && current.conflict?.conflictId === conflict.conflictId
        ? { ...current, conflict: null, decisionPending: false }
        : current)
    } catch (error) {
      showToast('error', `提交复制决策失败：${errorMessage(error)}`)
      setActiveRemoteCopy((current) => current?.requestId === copy.requestId
        ? { ...current, decisionPending: false }
        : current)
    }
  }

  const beginRemoteMove = (sourcePaths: string[], targetDirectory: string, consumeCutClipboard = false) => {
    const session = activeSession
    if (!session || session.kind !== 'sftp' || session.status !== 'connected' || activeRemoteMove || activeRemoteCopy) return
    const cutClipboard = consumeCutClipboard && remoteClipboard?.mode === 'cut' ? remoteClipboard : null
    const requestId = window.crypto.randomUUID()
    const profileId = session.profileId
    const pathsToMove = [...sourcePaths]
    setActiveRemoteMove({
      requestId,
      sessionId: session.id,
      progress: { requestId, sessionId: session.id, completedCount: 0, totalCount: pathsToMove.length, currentPath: null },
      conflict: null,
      decisionPending: false,
    })
    void (async () => {
      try {
        const result = await window.remoteFiles.moveRemoteEntries({ requestId, sessionId: session.id, sourcePaths: pathsToMove, targetDirectory })
        showRemoteOperationResult('move', result)
        if (cutClipboard && cutClipboard.sourcePaths.length === pathsToMove.length
          && cutClipboard.sourcePaths.every((path, index) => path === pathsToMove[index])) {
          const completedPaths = new Set(result.results
            .filter((item) => item.status === 'moved' && !item.message)
            .map((item) => item.sourcePath))
          const remainingPaths = pathsToMove.filter((path) => !completedPaths.has(path))
          setRemoteClipboard((current) => current?.mode === 'cut'
            && current.profile.id === cutClipboard.profile.id
            && current.profile.host === cutClipboard.profile.host
            && current.profile.port === cutClipboard.profile.port
            && current.profile.username === cutClipboard.profile.username
            && current.sourcePaths.length === cutClipboard.sourcePaths.length
            && current.sourcePaths.every((path, index) => path === cutClipboard.sourcePaths[index])
            ? remainingPaths.length > 0 ? { ...current, sourcePaths: current.sourcePaths.filter((path) => remainingPaths.includes(path)) } : null
            : current)
        }
      } catch (error) {
        showToast('error', `移动失败：${errorMessage(error)}`)
      } finally {
        setActiveRemoteMove((current) => current?.requestId === requestId ? null : current)
        const affectedDirectories = new Set([
          ...pathsToMove.map(getParentPath),
          targetDirectory,
          getParentPath(targetDirectory),
        ])
        const sessionsToRefresh = sessionsRef.current.filter((candidate) => candidate.profileId === profileId
          && candidate.kind === 'sftp' && candidate.status === 'connected'
          && affectedDirectories.has(candidate.currentPath))
        await Promise.all(sessionsToRefresh.map((candidate) => loadDirectory(candidate.id, candidate.currentPath)))
      }
    })()
  }

  const pasteRemoteEntries = (targetDirectory: string) => {
    if (remoteClipboard?.mode === 'cut') beginRemoteMove(remoteClipboard.sourcePaths, targetDirectory, true)
    else beginRemoteCopy(targetDirectory)
  }

  const decideRemoteMoveConflict = async (decision: RemoteMoveDecision) => {
    const move = activeRemoteMove
    const conflict = move?.conflict
    if (!move || !conflict || move.decisionPending) return
    setActiveRemoteMove((current) => current?.requestId === move.requestId
      ? { ...current, decisionPending: true }
      : current)
    try {
      const accepted = await window.remoteFiles.decideRemoteMove(move.requestId, conflict.conflictId, decision)
      if (!accepted) throw new Error('移动冲突已失效，请重试')
      setActiveRemoteMove((current) => current?.requestId === move.requestId && current.conflict?.conflictId === conflict.conflictId
        ? { ...current, conflict: null, decisionPending: false }
        : current)
    } catch (error) {
      showToast('error', `提交移动决策失败：${errorMessage(error)}`)
      setActiveRemoteMove((current) => current?.requestId === move.requestId
        ? { ...current, decisionPending: false }
        : current)
    }
  }

  const cancelActiveRemoteMove = () => {
    const move = activeRemoteMove
    if (!move) return
    void window.remoteFiles.cancelRemoteMove(move.requestId).then((cancelled) => {
      if (!cancelled && activeRemoteMove?.requestId === move.requestId) showToast('info', '移动任务已结束')
    }).catch((error) => showToast('error', `取消移动失败：${errorMessage(error)}`))
  }

  return {
    activeRemoteMove,
    activeRemoteCopy,
    canPasteRemote,
    remoteClipboard,
    remoteEntryDeleteDialog,
    remoteEntryDeleteError,
    remoteEntryDeleting,
    remoteOperationSummary,
    remoteOperationDetailsOpen,
    setRemoteOperationDetailsOpen,
    createDirectoryDialog,
    setCreateDirectoryDialog,
    creatingDirectory,
    activeArchiveExtraction,
    archiveDestinationDialog,
    archiveSummary,
    submitCreateDirectory,
    extractRemoteArchive,
    beginArchiveExtractionAt,
    decideRemoteArchiveConflict,
    cancelActiveArchiveExtraction,
    closeArchiveSummary,
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
    decideRemoteCopyConflict,
    decideRemoteMoveConflict,
    cancelActiveRemoteMove,
  }
}
