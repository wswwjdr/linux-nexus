import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Cloud, Copy, FolderOpen, FolderUp, House, Keyboard, LoaderCircle, Plus, RefreshCw, Search, Settings, Terminal, Upload, X } from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import FileBrowser from './components/FileBrowser'
import SftpContextMenu from './components/context-menus/SftpContextMenu'
import ServerList from './components/ServerList'
import TransferTray from './components/TransferTray'
import SearchDialog from './components/SearchDialog'
import DialogLayer from './components/DialogLayer'
import ConfirmationDialog from './components/ConfirmationDialog'
import { RemoteMoveConflictDialog, RemoteMoveSummaryDialog } from './components/RemoteMoveDialogs'
import SessionChooser from './components/SessionChooser'
import TerminalPanel from './components/TerminalPanel'
import ShortcutGuideDialog from './components/ShortcutGuideDialog'
import PerformanceMonitor, { type PerformanceMonitorState } from './components/PerformanceMonitor'
import { usePreview } from './hooks/usePreview'
import { useTransfers } from './hooks/useTransfers'
import { useProfileManagement } from './hooks/useProfileManagement'
import { useCommandAliases } from './hooks/useCommandAliases'
import type {
  FileTypeExtensions,
  PerformanceThresholds,
  PerformanceUpdate,
  RemoteCopyConflict,
  RemoteCopyDecision,
  RemoteCopyEvent,
  RemoteCopyResult,
  RemoteMoveConflict,
  RemoteMoveDecision,
  RemoteMoveProgress,
  RemoteMoveResult,
  RemoteEntry,
  SearchResultTarget,
  ScriptExecutionEvent,
  ScriptExecutionRequest,
  ServerProfile,
  SessionKind,
  TrustHostKeyInput,
} from '@shared/types'
import { DEFAULT_PERFORMANCE_THRESHOLDS, defaultFileTypeExtensions } from '@shared/app-settings'
import { scriptExecutionCommand } from '@shared/shell'
import type { SftpContextMenuContext, SftpMenuAction } from './context-menu/sftp-menu'
import type {
  BrowserContextMenu as BrowserContextMenuState,
  FileViewMode,
  PendingHostKey,
  RecentConnection,
  SessionTab,
  SortColumn,
  SortDirection,
  ScriptExecutionDialogState,
} from './app-types'
import {
  connectFailureText,
  entryNameCollator,
  errorMessage,
  readRecentConnections,
  getParentPath,
} from './app-utils'

const entryTypeLabels: Record<RemoteEntry['type'], string> = {
  directory: '文件夹',
  file: '文件',
  symlink: '符号链接',
  other: '其他',
}

interface SessionContextMenuState {
  sessionId: string
  x: number
  y: number
}

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

function getEntryTypeExtension(name: string): string {
  const extensionStart = name.lastIndexOf('.')
  return extensionStart > 0 && extensionStart < name.length - 1
    ? name.slice(extensionStart + 1).toLocaleLowerCase('zh-CN')
    : ''
}

export default function App() {
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionChooserOpen, setSessionChooserOpen] = useState(false)
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false)
  const [viewModeDefault, setViewModeDefault] = useState<FileViewMode>('details')
  const [performanceThresholds, setPerformanceThresholds] = useState<PerformanceThresholds>(DEFAULT_PERFORMANCE_THRESHOLDS)
  const [performanceMonitorState, setPerformanceMonitorState] = useState<PerformanceMonitorState | null>(null)
  const [performancePanelOpen, setPerformancePanelOpen] = useState(false)
  const [fileTypeExtensions, setFileTypeExtensions] = useState<FileTypeExtensions>(defaultFileTypeExtensions)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [pendingHostKeys, setPendingHostKeys] = useState<PendingHostKey[]>([])
  const [browserContextMenu, setBrowserContextMenu] = useState<BrowserContextMenuState | null>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [remoteEntryDeleteDialog, setRemoteEntryDeleteDialog] = useState<{ entries: RemoteEntry[]; sessionId: string; directory: string } | null>(null)
  const [remoteEntryDeleteError, setRemoteEntryDeleteError] = useState<string | null>(null)
  const [remoteEntryDeleting, setRemoteEntryDeleting] = useState(false)
  const [activeRemoteMove, setActiveRemoteMove] = useState<ActiveRemoteMove | null>(null)
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [activeRemoteCopy, setActiveRemoteCopy] = useState<ActiveRemoteCopy | null>(null)
  const [remoteOperationSummary, setRemoteOperationSummary] = useState<RemoteOperationSummary | null>(null)
  const [remoteOperationDetailsOpen, setRemoteOperationDetailsOpen] = useState(false)
  const [createDirectoryDialog, setCreateDirectoryDialog] = useState<{ name: string } | null>(null)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [scriptCommandDialog, setScriptCommandDialog] = useState<{ entry: Pick<RemoteEntry, 'name' | 'path'>; sessionId: string; command: string } | null>(null)
  const [scriptExecutionDialog, setScriptExecutionDialog] = useState<ScriptExecutionDialogState | null>(null)
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null)
  const toastSequenceRef = useRef(0)
  const startupConnectionAttemptedRef = useRef(false)
  const connectingSessionsRef = useRef(new Set<string>())
  const directoryLoadIdsRef = useRef(new Map<string, number>())
  const contextMenuAnchorRef = useRef<HTMLElement | null>(null)
  const sessionContextMenuRef = useRef<HTMLDivElement>(null)
  const activeSessionIdRef = useRef(activeSessionId)
  const performanceMonitorIdRef = useRef<string | null>(null)
  activeSessionIdRef.current = activeSessionId
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const patchSession = useCallback((sessionId: string, patch: Partial<SessionTab>) => {
    sessionsRef.current = sessionsRef.current.map((session) => session.id === sessionId ? { ...session, ...patch } : session)
    setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, ...patch } : session))
  }, [])
  const updateSession = useCallback((sessionId: string, update: (session: SessionTab) => SessionTab) => {
    sessionsRef.current = sessionsRef.current.map((session) => session.id === sessionId ? update(session) : session)
    setSessions((current) => current.map((session) => session.id === sessionId ? update(session) : session))
  }, [])
  const showToast = useCallback((kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => {
    setToast({ id: ++toastSequenceRef.current, kind, message, action })
  }, [])
  const {
    previewDialog,
    logPreviewDialog,
    imageZoom,
    imagePreviewSize,
    textDraft,
    textDirty,
    textSaving,
    textSaveConfirmation,
    textSaveError,
    imageViewportRef,
    previewImageRef,
    logViewportRef,
    closePreview,
    previewFile,
    previewLogFile,
    onLogPreviewScroll,
    updateTextDraft,
    requestTextSave,
    confirmTextSave,
    cancelTextSave,
    onImageLoad,
    zoomImage,
  } = usePreview({
    sessionId: sessions.find((session) => session.id === activeSessionId)?.kind === 'sftp'
      && sessions.find((session) => session.id === activeSessionId)?.status === 'connected'
      ? activeSessionId
      : null,
    fileTypeExtensions,
    showToast,
  })
  const dismissToast = useCallback((noticeId: number) => {
    setToast((current) => current?.id === noticeId ? null : current)
  }, [])
  const {
    profiles,
    profileDataLoaded,
    startupConnection,
    profileDialog,
    profileDeleteDialog,
    profileDeleteError,
    profileDeleting,
    settingsForm,
    settingsLoading,
    openProfileDialog,
    openSettingsDialog,
    updateProfileForm,
    submitProfile,
    requestProfileDeletion,
    closeProfileDeleteDialog,
    confirmProfileDeletion,
    updateSettingsForm,
    addFileTypeExtension,
    removeFileTypeExtension,
    resetFileTypeExtensions,
    updateDefaultView,
    updateTheme,
    updateStartupProfile,
    updateStartupKind,
    closeProfileDialog,
    closeSettingsDialog,
  } = useProfileManagement({
    showToast,
    onProfileSaved: (profile) => {
      const affectedSessions = sessionsRef.current.filter((session) => session.profileId === profile.id)
      const activeProfileId = sessionsRef.current.find((session) => session.id === activeSessionId)?.profileId
      if (activeProfileId === profile.id) closePreview()
      setPendingHostKeys((current) => current.filter((pending) => pending.profile.id !== profile.id))
      for (const session of affectedSessions) {
        patchSession(session.id, { status: 'disconnected', error: '服务器配置已更新', loading: false })
      }
      if (searchSessionId && affectedSessions.some((session) => session.id === searchSessionId)) setSearchSessionId(null)
    },
    onProfileDeleted: (profileId) => {
      setRecentConnections((current) => current.filter((connection) => connection.profileId !== profileId))
      const affectedSessions = sessionsRef.current.filter((session) => session.profileId === profileId)
      const activeProfileId = sessionsRef.current.find((session) => session.id === activeSessionId)?.profileId
      if (activeProfileId === profileId) closePreview()
      setPendingHostKeys((current) => current.filter((pending) => pending.profile.id !== profileId))
      const remaining = sessionsRef.current.filter((session) => session.profileId !== profileId)
      sessionsRef.current = remaining
      setSessions(remaining)
      for (const session of affectedSessions) {
        directoryLoadIdsRef.current.delete(session.id)
        connectingSessionsRef.current.delete(session.id)
      }
      if (searchSessionId && affectedSessions.some((session) => session.id === searchSessionId)) setSearchSessionId(null)
      if (activeSessionId && !remaining.some((session) => session.id === activeSessionId)) {
        setActiveSessionId(remaining.at(-1)?.id ?? null)
      }
    },
    onDefaultViewChange: (mode) => {
      setViewModeDefault(mode)
      setSessions((current) => current.map((session) => session.kind === 'sftp' ? { ...session, viewMode: mode } : session))
    },
    onFileTypeExtensionsChange: setFileTypeExtensions,
    onPerformanceThresholdsChange: setPerformanceThresholds,
  })

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )
  const connectedProfileId = activeSession?.status === 'connected' ? activeSession.profileId : null
  const connectedSessionId = connectedProfileId ? activeSessionId : null
  const setPerformancePanel = useCallback((open: boolean) => setPerformancePanelOpen(open), [])
  const currentPath = activeSession?.currentPath ?? '/'
  const entries = activeSession?.entries ?? []
  const loading = activeSession?.loading ?? false
  const viewMode = activeSession?.viewMode ?? viewModeDefault
  const sort = activeSession?.sort ?? { column: 'name' as SortColumn, direction: 'ascending' as SortDirection }
  const highlightedPath = activeSession?.highlightedPath ?? null
  const connectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeSession?.profileId) ?? null,
    [profiles, activeSession?.profileId],
  )

  useEffect(() => window.remoteFiles.onPerformanceUpdate((event: PerformanceUpdate) => {
    if (event.sessionId !== activeSessionIdRef.current || event.monitorId !== performanceMonitorIdRef.current) return
    setPerformanceMonitorState((current) => {
      if (!current || current.sessionId !== event.sessionId || current.monitorId !== event.monitorId) return current
      if (event.status === 'ready' && event.snapshot) {
        const history = [...current.history, event.snapshot].slice(-180)
        return { ...current, status: 'ready', snapshot: event.snapshot, message: null, history }
      }
      return { ...current, status: event.status, message: event.status === 'error' ? event.message ?? '性能指标采集失败' : null }
    })
  }), [])

  useEffect(() => {
    setPerformancePanelOpen(false)
    if (!connectedSessionId) {
      performanceMonitorIdRef.current = null
      setPerformanceMonitorState(null)
      return
    }
    const sessionId = connectedSessionId
    const monitorId = window.crypto.randomUUID()
    performanceMonitorIdRef.current = monitorId
    setPerformanceMonitorState({ sessionId, monitorId, status: 'sampling', snapshot: null, message: null, history: [] })
    void window.remoteFiles.startPerformanceMonitor(sessionId, monitorId).catch((error: unknown) => {
      if (performanceMonitorIdRef.current !== monitorId || activeSessionIdRef.current !== sessionId) return
      setPerformanceMonitorState((current) => current?.monitorId === monitorId
        ? { ...current, status: 'error', message: errorMessage(error) }
        : current)
    })
    return () => {
      if (performanceMonitorIdRef.current === monitorId) performanceMonitorIdRef.current = null
      void window.remoteFiles.stopPerformanceMonitor(sessionId, monitorId).catch(() => {})
    }
  }, [connectedSessionId])

  const refreshPerformance = useCallback((sessionId: string, monitorId: string) => {
    setPerformanceMonitorState((current) => current?.sessionId === sessionId && current.monitorId === monitorId
      ? { ...current, status: 'sampling', message: null }
      : current)
    void window.remoteFiles.refreshPerformanceMonitor(sessionId, monitorId).catch((error: unknown) => {
      setPerformanceMonitorState((current) => current?.sessionId === sessionId && current.monitorId === monitorId
        ? { ...current, status: 'error', message: errorMessage(error) }
        : current)
    })
  }, [])
  const clipboardMatchesProfile = Boolean(remoteClipboard && connectedProfile
    && remoteClipboard.profile.id === connectedProfile.id
    && remoteClipboard.profile.host === connectedProfile.host
    && remoteClipboard.profile.port === connectedProfile.port
    && remoteClipboard.profile.username === connectedProfile.username)
  const canPasteRemote = Boolean(clipboardMatchesProfile && activeSession?.kind === 'sftp'
    && activeSession.status === 'connected' && !activeRemoteCopy && !activeRemoteMove)
  const commandAliases = useCommandAliases({
    profiles,
    showToast,
  })
  const openSettings = () => {
    commandAliases.prepareForSettings(connectedProfileId)
    void openSettingsDialog()
  }
  const closeShortcutGuide = useCallback(() => setShortcutGuideOpen(false), [])
  const searchSession = useMemo(
    () => sessions.find((session) => session.id === searchSessionId) ?? null,
    [sessions, searchSessionId],
  )
  const searchProfile = useMemo(
    () => profiles.find((profile) => profile.id === searchSession?.profileId) ?? null,
    [profiles, searchSession?.profileId],
  )
  const pendingHostKey = pendingHostKeys[0] ?? null
  const modalOpen = Boolean(
    profileDialog || profileDeleteDialog || createDirectoryDialog || scriptCommandDialog || scriptExecutionDialog || settingsForm || previewDialog || logPreviewDialog
      || pendingHostKey || commandAliases.pendingHostKey || commandAliases.overwriteConfirmation
      || commandAliases.deleteConfirmation || remoteEntryDeleteDialog || activeRemoteMove?.conflict
      || activeRemoteCopy?.conflict || remoteOperationDetailsOpen || searchSessionId
      || sessionChooserOpen || shortcutGuideOpen,
  )
  const offlineProfiles = useMemo(
    () => {
      const connectionTimes = new Map(
        recentConnections.map((connection) => [connection.profileId, connection.connectedAt] as const),
      )
      return profiles
        .map((profile, index) => ({ profile, index, connectedAt: connectionTimes.get(profile.id) }))
        .sort((left, right) => {
          if (left.connectedAt === undefined) {
            return right.connectedAt === undefined ? left.index - right.index : 1
          }
          if (right.connectedAt === undefined) return -1
          return right.connectedAt - left.connectedAt || left.index - right.index
        })
    },
    [profiles, recentConnections],
  )

  useEffect(() => {
    window.localStorage.setItem('remote-files:recent-connections', JSON.stringify(recentConnections))
  }, [recentConnections])

  useEffect(() => {
    const openSearchShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return
      if (shortcutGuideOpen) {
        event.preventDefault()
        return
      }
      if (activeSession?.kind !== 'sftp' || activeSession.status !== 'connected') return
      event.preventDefault()
      if (!searchSessionId) setSearchSessionId(activeSession.id)
    }
    window.addEventListener('keydown', openSearchShortcut)
    return () => window.removeEventListener('keydown', openSearchShortcut)
  }, [activeSession, searchSessionId, shortcutGuideOpen])

  useEffect(() => {
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === event.sessionId)
      if (!session) return
      patchSession(event.sessionId, { status: 'disconnected', error: event.message, loading: false })
      if (activeSessionId === event.sessionId) showToast('error', `连接已断开：${event.message}`)
    })
    return removeClosedListener
  }, [activeSessionId, patchSession, showToast])

  useEffect(() => window.remoteFiles.onScriptExecutionEvent((event: ScriptExecutionEvent) => {
    setScriptExecutionDialog((current) => {
      if (!current || current.request.requestId !== event.requestId) return current
      if (event.type === 'output') {
        return { ...current, output: [...current.output, { stream: event.stream, data: event.data }] }
      }
      if (event.type === 'completed') return { ...current, status: 'completed', message: '退出码 0' }
      if (event.type === 'cancelled') return { ...current, status: 'cancelled', message: null }
      return { ...current, status: 'failed', message: event.message }
    })
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

  useEffect(() => {
    if (!sessionContextMenu) return

    const dismissOutside = (event: PointerEvent) => {
      if (!sessionContextMenuRef.current?.contains(event.target as Node)) setSessionContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSessionContextMenu(null)
    }
    const dismiss = () => setSessionContextMenu(null)

    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    sessionContextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [sessionContextMenu])

  const loadDirectory = async (sessionId: string, remotePath: string) => {
    if (!sessionsRef.current.some((session) => session.id === sessionId && session.status === 'connected')) return false
    const requestId = (directoryLoadIdsRef.current.get(sessionId) ?? 0) + 1
    directoryLoadIdsRef.current.set(sessionId, requestId)
    patchSession(sessionId, { highlightedPath: null, loading: true, error: null })
    try {
      const nextEntries = await window.remoteFiles.listDirectory(sessionId, remotePath)
      if (directoryLoadIdsRef.current.get(sessionId) !== requestId
        || !sessionsRef.current.some((session) => session.id === sessionId && session.status === 'connected')) return false
      updateSession(sessionId, (session) => ({
        ...session,
        entries: nextEntries,
        currentPath: remotePath,
        loading: false,
        selectedPaths: session.currentPath === remotePath
          ? session.selectedPaths.filter((path) => nextEntries.some((entry) => entry.path === path))
          : [],
      }))
      return true
    } catch (error) {
      if (directoryLoadIdsRef.current.get(sessionId) === requestId
        && sessionsRef.current.some((session) => session.id === sessionId && session.status === 'connected')) {
        patchSession(sessionId, { loading: false })
        if (activeSessionId === sessionId) showToast('error', errorMessage(error))
      }
      return false
    }
  }

  const {
    transfers,
    cancelTransfer: cancelTransferJob,
    uploadFiles,
    uploadFolder,
    uploadDroppedEntries,
    download,
    dismissTransfer,
  } = useTransfers({
    sessionId: connectedSessionId,
    currentPath,
    profileName: connectedProfile?.name ?? '',
    loadDirectory,
    showToast,
  })

  const connectSession = async (session: SessionTab, profile: ServerProfile) => {
    if (connectingSessionsRef.current.has(session.id)) return
    connectingSessionsRef.current.add(session.id)
    patchSession(session.id, { status: 'connecting', error: null })
    try {
      const result = await window.remoteFiles.connect(
        session.id,
        profile.id,
        session.kind,
        100,
        30,
        session.kind === 'terminal' ? session.startPath : '',
      )
      if (!sessionsRef.current.some((candidate) => candidate.id === session.id)) {
        if (result.ok) await window.remoteFiles.disconnect(session.id)
        return
      }
      if (!result.ok) {
        const latestSession = sessionsRef.current.find((candidate) => candidate.id === session.id)
        if (result.reason === 'other' && result.message === '连接已取消'
          && latestSession?.status !== 'connecting') return
        if (result.reason === 'host-key-unknown') {
          patchSession(session.id, { status: 'awaiting-trust' })
          setPendingHostKeys((current) => [...current, {
            sessionId: session.id,
            profile,
            kind: session.kind,
            startPath: session.startPath,
            fingerprint: result.fingerprint,
          }])
        } else if (result.reason === 'host-key-changed') {
          patchSession(session.id, { status: 'awaiting-trust' })
          setPendingHostKeys((current) => [...current, {
            sessionId: session.id,
            profile,
            kind: session.kind,
            startPath: session.startPath,
            fingerprint: result.fingerprint,
            previousFingerprint: result.previousFingerprint,
          }])
        } else {
          const message = connectFailureText(result)
          patchSession(session.id, { status: 'disconnected', error: message })
          if (activeSessionId === session.id) showToast('error', message)
        }
        return
      }
      patchSession(session.id, { status: 'connected', error: null })
      setRecentConnections((current) => [
        { profileId: profile.id, connectedAt: Date.now() },
        ...current.filter((connection) => connection.profileId !== profile.id),
      ])
      if (session.kind === 'sftp') {
        const path = session.currentPath || result.path
        patchSession(session.id, {
          currentPath: path,
          history: session.history.length ? session.history : [path],
          historyIndex: session.history.length ? session.historyIndex : 0,
        })
        await loadDirectory(session.id, path)
      }
    } catch (error) {
      const message = errorMessage(error)
      patchSession(session.id, { status: 'disconnected', error: message })
      if (activeSessionId === session.id) showToast('error', message)
    } finally {
      connectingSessionsRef.current.delete(session.id)
    }
  }

  const openSession = (profile: ServerProfile, kind: SessionKind, startPath = '', source?: SessionTab) => {
    const id = crypto.randomUUID()
    const currentPath = kind === 'sftp' ? source?.currentPath || '/' : ''
    const session: SessionTab = {
      id,
      profileId: profile.id,
      kind,
      status: 'connecting',
      currentPath,
      startPath,
      entries: [],
      selectedPaths: [],
      loading: kind === 'sftp',
      viewMode: source?.viewMode ?? viewModeDefault,
      sort: source?.sort ?? { column: 'name', direction: 'ascending' },
      highlightedPath: null,
      history: kind === 'sftp' ? [currentPath] : [],
      historyIndex: kind === 'sftp' ? 0 : -1,
      error: null,
    }
    setBrowserContextMenu(null)
    setSessionContextMenu(null)
    setSearchSessionId(null)
    closePreview()
    setActiveSessionId(id)
    const nextSessions = [...sessionsRef.current, session]
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
    setSessionChooserOpen(false)
    void connectSession(session, profile)
  }

  const requestScriptCommandEdit = (entry: Pick<RemoteEntry, 'name' | 'path'>, sessionId = activeSession?.id) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || session.kind !== 'sftp' || session.status !== 'connected') return
    setBrowserContextMenu(null)
    setScriptCommandDialog({
      entry,
      sessionId: session.id,
      command: scriptExecutionCommand(entry.name),
    })
  }

  const startScriptExecution = (entry: Pick<RemoteEntry, 'name' | 'path'>, command: string, sessionId = activeSession?.id) => {
    setBrowserContextMenu(null)
    setScriptCommandDialog(null)
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || session.kind !== 'sftp' || session.status !== 'connected') {
      showToast('error', 'SFTP 会话已断开，无法执行脚本')
      return
    }
    const request: ScriptExecutionRequest = {
      requestId: crypto.randomUUID(),
      sessionId: session.id,
      scriptPath: entry.path,
      command,
    }
    setScriptExecutionDialog({ request, name: entry.name, status: 'starting', output: [], message: null })
    void window.remoteFiles.startScriptExecution(request).then(() => {
      setScriptExecutionDialog((current) => current?.request.requestId === request.requestId && current.status === 'starting'
        ? { ...current, status: 'running', message: null }
        : current)
    }).catch((error) => {
      setScriptExecutionDialog((current) => current?.request.requestId === request.requestId
        ? { ...current, status: 'failed', message: errorMessage(error) }
        : current)
    })
  }

  const submitScriptCommand = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!scriptCommandDialog || !scriptCommandDialog.command.trim()) return
    if (scriptCommandDialog.command.length > 65535) {
      showToast('error', '命令长度不能超过 65535 个字符')
      return
    }
    startScriptExecution(scriptCommandDialog.entry, scriptCommandDialog.command, scriptCommandDialog.sessionId)
  }

  const closeScriptExecutionDialog = () => {
    if (scriptExecutionDialog && ['starting', 'running', 'cancelling'].includes(scriptExecutionDialog.status)) {
      void window.remoteFiles.cancelScriptExecution(scriptExecutionDialog.request.requestId)
    }
    setScriptExecutionDialog(null)
  }

  const stopScriptExecution = () => {
    if (!scriptExecutionDialog || !['starting', 'running'].includes(scriptExecutionDialog.status)) return
    const requestId = scriptExecutionDialog.request.requestId
    setScriptExecutionDialog((current) => current?.request.requestId === requestId
      ? { ...current, status: 'cancelling', message: null }
      : current)
    void window.remoteFiles.cancelScriptExecution(requestId)
  }

  useEffect(() => {
    if (!profileDataLoaded || startupConnectionAttemptedRef.current) return
    startupConnectionAttemptedRef.current = true
    if (!startupConnection || sessionsRef.current.length > 0) return
    const profile = profiles.find((candidate) => candidate.id === startupConnection.profileId)
    if (!profile) {
      showToast('error', '启动连接所选服务器不存在，请在设置中重新选择')
      return
    }
    openSession(profile, startupConnection.kind)
  }, [profileDataLoaded, startupConnection, profiles, showToast])

  const createChosenSession = (profileId: string, kind: SessionKind) => {
    const profile = profiles.find((candidate) => candidate.id === profileId)
    if (profile) openSession(profile, kind)
  }

  const duplicateSession = (sessionId: string) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId)
    const profile = profiles.find((candidate) => candidate.id === source?.profileId)
    if (!source || !profile) return
    openSession(profile, source.kind, source.startPath, source)
  }

  const openSessionContextMenu = (sessionId: string, x: number, y: number) => {
    const menuWidth = 204
    const menuHeight = 48
    const inset = 8
    setBrowserContextMenu(null)
    setSessionContextMenu({
      sessionId,
      x: Math.max(inset, Math.min(x, window.innerWidth - menuWidth - inset)),
      y: Math.max(inset, Math.min(y, window.innerHeight - menuHeight - inset)),
    })
  }

  const handleSessionTabContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, sessionId: string) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    openSessionContextMenu(sessionId, bounds.left + 12, bounds.bottom)
  }

  const reconnectSession = (sessionId: string) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    const profile = profiles.find((candidate) => candidate.id === session?.profileId)
    if (!session || !profile) return
    setActiveSessionId(session.id)
    void connectSession(session, profile)
  }

  const closeSession = (sessionId: string) => {
    const previousSessions = sessionsRef.current
    const closing = previousSessions.find((session) => session.id === sessionId)
    if (!closing) return
    const previousIndex = previousSessions.findIndex((session) => session.id === sessionId)
    directoryLoadIdsRef.current.delete(sessionId)
    const remaining = previousSessions.filter((session) => session.id !== sessionId)
    sessionsRef.current = remaining
    setSessions(remaining)
    setPendingHostKeys((current) => current.filter((pending) => pending.sessionId !== sessionId))
    if (activeSessionId === sessionId) {
      const next = remaining[previousIndex] ?? remaining[previousIndex - 1]
      setActiveSessionId(next?.id ?? null)
      closePreview()
    }
    if (searchSessionId === sessionId) setSearchSessionId(null)
    setBrowserContextMenu(null)
    setSessionContextMenu(null)
    void window.remoteFiles.disconnect(sessionId).catch((error) => showToast('error', errorMessage(error)))
  }

  const activateSession = (sessionId: string) => {
    if (activeSessionId === sessionId) return
    closePreview()
    setSearchSessionId(null)
    setBrowserContextMenu(null)
    setCreateDirectoryDialog(null)
    setActiveSessionId(sessionId)
  }

  const goHome = () => {
    closePreview()
    setSearchSessionId(null)
    setBrowserContextMenu(null)
    setCreateDirectoryDialog(null)
    setActiveSessionId(null)
  }

  const navigateSession = (sessionId: string, remotePath: string): Promise<boolean> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session?.kind !== 'sftp' || session.status !== 'connected') return Promise.resolve(false)
    const nextHistory = session.history.slice(0, session.historyIndex + 1)
    if (nextHistory.at(-1) !== remotePath) nextHistory.push(remotePath)
    updateSession(sessionId, (current) => ({
      ...current,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    }))
    return loadDirectory(sessionId, remotePath).then((loaded) => {
      if (!loaded && sessionsRef.current.some((candidate) => candidate.id === sessionId)) {
        updateSession(sessionId, (current) => ({ ...current, history: session.history, historyIndex: session.historyIndex }))
      }
      return loaded
    })
  }

  const navigate = (remotePath: string): Promise<boolean> => activeSession
    ? navigateSession(activeSession.id, remotePath)
    : Promise.resolve(false)

  const locateSearchResult = async (result: SearchResultTarget) => {
    const sessionId = searchSessionId
    setSearchSessionId(null)
    if (!sessionId) return
    activateSession(sessionId)
    const loaded = await navigateSession(sessionId, getParentPath(result.path))
    if (loaded) patchSession(sessionId, { highlightedPath: result.path })
  }

  const movePathHistory = (offset: -1 | 1) => {
    if (!activeSession || activeSession.kind !== 'sftp' || activeSession.status !== 'connected') return
    const previousIndex = activeSession.historyIndex
    const nextIndex = previousIndex + offset
    const remotePath = activeSession.history[nextIndex]
    if (remotePath === undefined) return

    patchSession(activeSession.id, { historyIndex: nextIndex })
    void loadDirectory(activeSession.id, remotePath).then((loaded) => {
      if (!loaded) patchSession(activeSession.id, { historyIndex: previousIndex })
    })
  }

  const trustAndReconnect = async () => {
    if (!pendingHostKey) return
    const trust: TrustHostKeyInput = {
      profileId: pendingHostKey.profile.id,
      fingerprint: pendingHostKey.fingerprint,
      previousFingerprint: pendingHostKey.previousFingerprint,
    }
    try {
      await window.remoteFiles.trustHostKey(trust)
      setPendingHostKeys((current) => current.filter((pending) => pending.sessionId !== pendingHostKey.sessionId))
      const session = sessionsRef.current.find((candidate) => candidate.id === pendingHostKey.sessionId)
      if (session) void connectSession(session, pendingHostKey.profile)
    } catch (error) {
      setPendingHostKeys((current) => current.filter((pending) => pending.sessionId !== pendingHostKey.sessionId))
      patchSession(pendingHostKey.sessionId, { status: 'disconnected', error: errorMessage(error) })
      showToast('error', errorMessage(error))
    }
  }

  const dismissHostKey = () => {
    if (!pendingHostKey) return
    setPendingHostKeys((current) => current.filter((pending) => pending.sessionId !== pendingHostKey.sessionId))
    patchSession(pendingHostKey.sessionId, { status: 'disconnected', error: '服务器指纹尚未验证' })
  }

  const openBrowserContextMenu = (menu: BrowserContextMenuState) => {
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

  const dispatchSftpMenuAction = (action: SftpMenuAction, context: SftpContextMenuContext) => {
    setBrowserContextMenu(null)
    if (context.kind === 'search-result'
      && (action.type === 'run-script' || action.type === 'adjust-script-command')) setSearchSessionId(null)
    const entry = context.kind === 'single-entry' ? context.entry
      : context.kind === 'search-result' ? context.result
        : null
    const entries = context.kind === 'single-entry' ? [context.entry]
      : context.kind === 'multiple-entries' ? context.entries
        : null
    switch (action.type) {
      case 'preview':
        if (entry) void previewFile(entry, action.previewType)
        break
      case 'preview-log':
        if (entry) void previewLogFile(entry)
        break
      case 'run-script':
        if (entry) startScriptExecution(entry, scriptExecutionCommand(entry.name), context.kind === 'search-result' ? searchSessionId ?? undefined : undefined)
        break
      case 'adjust-script-command':
        if (entry) requestScriptCommandEdit(entry, context.kind === 'search-result' ? searchSessionId ?? undefined : undefined)
        break
      case 'download':
        if (entries) download(entries)
        break
      case 'copy':
        if (entries) copyRemoteSelection(entries)
        break
      case 'cut':
        if (entries) cutRemoteSelection(entries)
        break
      case 'paste':
        if (context.kind === 'directory-background') pasteRemoteEntries(context.directory)
        else if (context.kind === 'single-entry' && context.entry.type === 'directory') pasteRemoteEntries(context.entry.path)
        else pasteRemoteEntries(currentPath)
        break
      case 'copy-path':
        if (context.kind === 'single-entry') void copyEntryPath(context.entry)
        else if (context.kind === 'directory-background') void copyPath(context.directory)
        break
      case 'delete':
        if (entries) requestRemoteEntriesDeletion(entries)
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
        setCreateDirectoryDialog({ name: '' })
        break
      case 'upload':
        void uploadFiles()
        break
      case 'open-location':
        if (context.kind === 'search-result') void locateSearchResult(context.result)
        break
    }
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

  const copyEntryPath = (entry: RemoteEntry) => copyPath(entry.path)

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

  const submitCreateDirectory = async (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!connectedSessionId || !createDirectoryDialog) return
    const sessionId = connectedSessionId
    const directory = currentPath
    const { name } = createDirectoryDialog
    setCreatingDirectory(true)
    try {
      await window.remoteFiles.createRemoteDirectory(sessionId, directory, name)
      setCreateDirectoryDialog(null)
      if (await loadDirectory(sessionId, directory)) {
        showToast('info', '文件夹已创建')
      }
    } catch (error) {
      showToast('error', `创建失败：${errorMessage(error)}`)
    } finally {
      setCreatingDirectory(false)
    }
  }

  const requestRemoteEntriesDeletion = (entries: RemoteEntry[]) => {
    if (entries.length === 0) return
    if (!connectedSessionId) return
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
        const result = await window.remoteFiles.copyRemoteEntries({
          requestId,
          sessionId: session.id,
          sourcePaths,
          targetDirectory,
        })
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
        const result = await window.remoteFiles.moveRemoteEntries({
          requestId,
          sessionId: session.id,
          sourcePaths: pathsToMove,
          targetDirectory,
        })
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

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const items = [{ label: '/', path: '/' }]
    let path = ''
    for (const part of parts) {
      path += `/${part}`
      items.push({ label: part, path })
    }
    return items
  }, [currentPath])

  const sortedEntries = useMemo(() => [...entries].sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1
    if (left.type !== 'directory' && right.type === 'directory') return 1

    let comparison = 0
    if (sort.column === 'name') {
      comparison = entryNameCollator.compare(left.name, right.name)
    } else if (sort.column === 'size') {
      comparison = left.type === 'directory' ? 0 : left.size - right.size
    } else if (sort.column === 'type') {
      comparison = entryNameCollator.compare(entryTypeLabels[left.type], entryTypeLabels[right.type])
      if (comparison === 0 && left.type === 'file' && right.type === 'file') {
        comparison = entryNameCollator.compare(getEntryTypeExtension(left.name), getEntryTypeExtension(right.name))
      }
    } else if (sort.column === 'modifiedAt') {
      if (left.modifiedAt === null || right.modifiedAt === null) {
        if (left.modifiedAt === null && right.modifiedAt !== null) return 1
        if (left.modifiedAt !== null && right.modifiedAt === null) return -1
      } else {
        comparison = Date.parse(left.modifiedAt) - Date.parse(right.modifiedAt)
      }
    } else {
      comparison = entryNameCollator.compare(left.permissions, right.permissions)
    }

    if (comparison === 0) return entryNameCollator.compare(left.name, right.name)
    return sort.direction === 'ascending' ? comparison : -comparison
  }), [entries, sort])

  useEffect(() => {
    const handleRemoteFileShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || modalOpen || browserContextMenu || sessionContextMenu) return
      if (!activeSession || activeSession.kind !== 'sftp' || activeSession.status !== 'connected') return
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
        pasteRemoteEntries(activeSession.currentPath)
      }
    }

    window.addEventListener('keydown', handleRemoteFileShortcut)
    return () => window.removeEventListener('keydown', handleRemoteFileShortcut)
  }, [
    activeSession,
    browserContextMenu,
    canPasteRemote,
    copyRemoteSelection,
    cutRemoteSelection,
    modalOpen,
    pasteRemoteEntries,
    sessionContextMenu,
    sortedEntries,
  ])

  const toggleSort = (column: SortColumn) => {
    if (!activeSession || activeSession.kind !== 'sftp') return
    patchSession(activeSession.id, {
      sort: activeSession.sort.column === column
        ? { column, direction: activeSession.sort.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: 'ascending' },
    })
  }

  const openSearch = () => {
    if (activeSession?.kind === 'sftp' && activeSession.status === 'connected') setSearchSessionId(activeSession.id)
  }

  const openTerminalForCurrentPath = () => {
    if (!connectedProfile || activeSession?.kind !== 'sftp') return
    openSession(connectedProfile, 'terminal', currentPath)
  }

  const openSftpForCurrentProfile = () => {
    if (!activeSession || activeSession.kind !== 'terminal') return
    const existingSession = sessionsRef.current.find((session) =>
      session.profileId === activeSession.profileId && session.kind === 'sftp')
    if (existingSession) {
      activateSession(existingSession.id)
      return
    }
    if (connectedProfile) openSession(connectedProfile, 'sftp')
  }

  const reportTerminalError = useCallback((message: string) => {
    showToast('error', '终端操作失败：' + message)
  }, [showToast])

  const profileForSession = (session: SessionTab) => profiles.find((profile) => profile.id === session.profileId)

  if (!profileDataLoaded
    || (startupConnection && !startupConnectionAttemptedRef.current && sessions.length === 0)) {
    return (
      <div className="app-shell startup-shell">
        <main className="main-area">
          <div className="startup-loading" role="status" aria-label="正在启动">
            <LoaderCircle className="spin" size={22} />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className={'app-shell' + (modalOpen ? ' modal-open' : '')} onAuxClick={(event) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      movePathHistory(event.button === 3 ? -1 : 1)
    }}>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button toolbar-button"
              title="首页"
              aria-label="首页"
              disabled={!activeSession}
              onClick={goHome}
            >
              <House size={16} />
            </button>
            <button
              className="icon-button toolbar-button"
              title="设置"
              aria-label="设置"
              disabled={settingsLoading}
              onClick={openSettings}
            >
              <Settings size={16} />
            </button>
            <button
              className="icon-button toolbar-button"
              title="快捷键说明"
              aria-label="快捷键说明"
              onClick={() => setShortcutGuideOpen(true)}
            >
              <Keyboard size={16} />
            </button>
            {connectedProfile && <span className="topbar-separator" />}
            {connectedProfile && <span className="connected-host"><Cloud size={14} /> {connectedProfile.username}@{connectedProfile.host}</span>}
            {activeSession && activeSession.status !== 'connected' && (
              <span className={'active-session-status ' + activeSession.status}>
                {activeSession.status === 'connecting' ? '连接中'
                  : activeSession.status === 'awaiting-trust' ? '等待确认指纹'
                    : '已断开'}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {connectedSessionId && (
              <PerformanceMonitor
                state={performanceMonitorState?.sessionId === connectedSessionId ? performanceMonitorState : null}
                thresholds={performanceThresholds}
                open={performancePanelOpen}
                onOpenChange={setPerformancePanel}
                onRefresh={refreshPerformance}
              />
            )}
            {activeSession?.kind === 'sftp' && connectedSessionId ? (
              <>
                <button className="icon-button toolbar-button" title="搜索文件（Ctrl+F）" aria-label="搜索文件（Ctrl+F）" onClick={openSearch}>
                  <Search size={16} />
                </button>
                <button className="icon-button toolbar-button" title="新建 SSH 终端" aria-label="新建 SSH 终端" onClick={openTerminalForCurrentPath}>
                  <Terminal size={16} />
                </button>
                <button className="text-button upload-button" title="上传文件到当前目录" aria-label="上传文件到当前目录" onClick={uploadFiles}>
                  <Upload size={15} /> 上传文件
                </button>
                <button className="text-button upload-button" title="上传文件夹到当前目录" aria-label="上传文件夹到当前目录" onClick={uploadFolder}>
                  <FolderUp size={15} /> 上传文件夹
                </button>
                <button className="icon-button toolbar-button" title="刷新目录" aria-label="刷新目录" disabled={loading} onClick={() => void loadDirectory(connectedSessionId, currentPath)}>
                  <RefreshCw className={loading ? 'spin' : ''} size={17} />
                </button>
              </>
            ) : activeSession?.kind === 'terminal' && connectedSessionId ? (
              <button className="text-button" onClick={openSftpForCurrentProfile}><FolderOpen size={15} /> 文件管理</button>
            ) : activeSession?.status === 'disconnected' ? (
              <button className="text-button" onClick={() => reconnectSession(activeSession.id)}><RefreshCw size={14} /> 重连</button>
            ) : activeSession?.status === 'connecting' ? <LoaderCircle className="spin" size={17} /> : null}
          </div>
        </header>

        <nav className="session-tabbar" role="tablist" aria-label="会话标签">
          <div className="session-tab-list">
            {sessions.map((session) => {
              const profile = profileForSession(session)
              const isActive = activeSessionId === session.id
              const kindLabel = session.kind === 'sftp' ? 'SFTP' : 'SSH'
              const sameKindSessions = sessions.filter((candidate) =>
                candidate.profileId === session.profileId && candidate.kind === session.kind)
              const duplicateIndex = sameKindSessions.findIndex((candidate) => candidate.id === session.id)
              const baseLabel = profile?.name ?? '服务器'
              const label = sameKindSessions.length > 1 ? `${baseLabel} (${duplicateIndex + 1})` : baseLabel
              const title = `${label} · ${kindLabel}${session.kind === 'sftp' ? ' · ' + session.currentPath : ''}`
              return (
                <div
                  className={'session-tab ' + (isActive ? 'active' : '')}
                  key={session.id}
                  onMouseDown={(event) => {
                    if (event.button !== 1) return
                    event.preventDefault()
                    closeSession(session.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openSessionContextMenu(session.id, event.clientX, event.clientY)
                  }}
                >
                  <button
                    className="session-tab-select"
                    id={'session-tab-' + session.id}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={'session-panel-' + session.id}
                    title={title}
                    onClick={() => activateSession(session.id)}
                    onKeyDown={(event) => handleSessionTabContextMenuKeyDown(event, session.id)}
                  >
                    {session.kind === 'sftp' ? <FolderOpen size={14} /> : <Terminal size={14} />}
                    <span className="session-tab-label">{label}</span>
                    <small>{kindLabel}</small>
                    {session.status === 'connecting' || session.status === 'awaiting-trust'
                      ? <LoaderCircle className="spin session-tab-state" size={12} />
                      : <span className={'session-tab-state-dot ' + session.status} />}
                  </button>
                  <button
                    className="session-tab-close"
                    title={'关闭 ' + label + ' ' + kindLabel}
                    aria-label={'关闭 ' + label + ' ' + kindLabel}
                    onClick={() => closeSession(session.id)}
                  ><X size={13} /></button>
                </div>
              )
            })}
          </div>
          <button className="icon-button session-add-button" title="新建会话" aria-label="新建会话" onClick={() => setSessionChooserOpen(true)}>
            <Plus size={16} />
          </button>
        </nav>

        {sessionContextMenu && (
          <div
            className="browser-context-menu session-context-menu"
            ref={sessionContextMenuRef}
            role="menu"
            aria-label="会话操作"
            style={{ left: sessionContextMenu.x, top: sessionContextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button className="entry-context-action" role="menuitem" onClick={() => duplicateSession(sessionContextMenu.sessionId)}>
              <Copy size={16} /> 复制会话
            </button>
          </div>
        )}

        {activeSession?.kind === 'sftp' && connectedSessionId ? (
          <div className="sftp-session-panel" id={'session-panel-' + activeSession.id} role="tabpanel" aria-labelledby={'session-tab-' + activeSession.id}>
            <FileBrowser
              currentPath={currentPath}
              entries={entries}
              loading={loading}
              viewMode={viewMode}
              breadcrumbs={breadcrumbs}
              sort={sort}
              sortedEntries={sortedEntries}
              selectedPaths={activeSession.selectedPaths}
              moveProgress={activeRemoteMove?.sessionId === activeSession.id ? activeRemoteMove.progress : null}
              copying={activeRemoteCopy?.sessionId === activeSession.id}
              highlightedPath={highlightedPath}
              onViewModeChange={(mode) => patchSession(activeSession.id, { viewMode: mode })}
              onNavigate={navigate}
              onToggleSort={toggleSort}
              onSelectedPathsChange={(selectedPaths) => patchSession(activeSession.id, { selectedPaths })}
              onOpenEntryContextMenu={openEntryContextMenu}
              onOpenDirectoryContextMenu={openDirectoryContextMenu}
              onDeleteEntries={requestRemoteEntriesDeletion}
              onDropUpload={uploadDroppedEntries}
              onDropMove={beginRemoteMove}
              onCancelMove={cancelActiveRemoteMove}
              onDropError={(error) => showToast('error', errorMessage(error))}
            />
          </div>
        ) : !activeSession ? (
          <ServerList
            profiles={offlineProfiles}
            connectionPending={false}
            onAdd={() => openProfileDialog('create')}
            onConnect={openSession}
            onEdit={(profile) => openProfileDialog('edit', profile)}
            onDelete={requestProfileDeletion}
          />
        ) : activeSession?.kind === 'terminal' ? null : activeSession ? (
          <div className="session-connection-state" id={'session-panel-' + activeSession.id} role="tabpanel" aria-labelledby={'session-tab-' + activeSession.id}>
            {activeSession.status === 'connecting' ? <LoaderCircle className="spin" size={20} /> : <Cloud size={20} />}
            <strong>{activeSession.status === 'connecting' ? '正在连接服务器' : '会话已断开'}</strong>
            {activeSession.error && <span>{activeSession.error}</span>}
            {activeSession.status === 'disconnected' && <button className="text-button" onClick={() => reconnectSession(activeSession.id)}>重连</button>}
          </div>
        ) : null}

        <div className="terminal-session-stack" hidden={activeSession?.kind !== 'terminal'}>
          {sessions.filter((session) => session.kind === 'terminal').map((session) => (
            <div
              className="terminal-session-pane"
              id={'session-panel-' + session.id}
              role="tabpanel"
              aria-labelledby={'session-tab-' + session.id}
              hidden={activeSessionId !== session.id || activeSession?.kind !== 'terminal'}
              key={session.id}
            >
              {session.status !== 'connected' && (
                <div className={'terminal-session-notice ' + session.status}>
                  {session.error ?? (session.status === 'connecting' ? '正在连接 SSH 终端…' : '等待确认服务器指纹')}
                  {session.status === 'disconnected' && <button className="text-button" onClick={() => reconnectSession(session.id)}>重连</button>}
                </div>
              )}
              <TerminalPanel
                sessionId={session.id}
                active={activeSessionId === session.id && activeSession?.kind === 'terminal'}
                connected={session.status === 'connected'}
                onError={reportTerminalError}
              />
            </div>
          ))}
        </div>

        {browserContextMenu && activeSession?.kind === 'sftp' && (
          <SftpContextMenu
            context={browserContextMenu}
            position={browserContextMenu}
            fileTypeExtensions={fileTypeExtensions}
            anchorRef={contextMenuAnchorRef}
            onAction={dispatchSftpMenuAction}
            onClose={() => setBrowserContextMenu(null)}
          />
        )}

        <TransferTray
          transfers={transfers}
          onCancel={cancelTransferJob}
          onDismiss={dismissTransfer}
        />
      </main>

      <GlobalToast notice={toast} onDismiss={dismissToast} />

      {shortcutGuideOpen && <ShortcutGuideDialog onClose={closeShortcutGuide} />}

      <DialogLayer
        profileDialog={profileDialog}
        profileDeleteDialog={profileDeleteDialog}
        profileDeleteError={profileDeleteError}
        profileDeleting={profileDeleting}
        createDirectoryDialog={createDirectoryDialog}
        creatingDirectory={creatingDirectory}
        scriptCommandDialog={scriptCommandDialog ? { name: scriptCommandDialog.entry.name, command: scriptCommandDialog.command } : null}
        scriptExecutionDialog={scriptExecutionDialog}
        settingsForm={settingsForm}
        profiles={profiles}
        previewDialog={previewDialog}
        logPreviewDialog={logPreviewDialog}
        textDraft={textDraft}
        textDirty={textDirty}
        textSaving={textSaving}
        textSaveConfirmation={textSaveConfirmation}
        textSaveError={textSaveError}
        pendingHostKey={pendingHostKey}
        pendingAliasHostKey={commandAliases.pendingHostKey}
        aliasSnapshot={commandAliases.snapshot}
        aliasProfileId={commandAliases.selectedProfileId}
        aliasOperationBusy={commandAliases.operation !== null}
        aliasName={commandAliases.name}
        aliasCommand={commandAliases.command}
        aliasOverwriteConfirmation={commandAliases.overwriteConfirmation}
        aliasDeleteConfirmation={commandAliases.deleteConfirmation}
        imageZoom={imageZoom}
        imagePreviewSize={imagePreviewSize}
        imageViewportRef={imageViewportRef}
        previewImageRef={previewImageRef}
        logViewportRef={logViewportRef}
        onCloseProfile={closeProfileDialog}
        onCloseProfileDelete={closeProfileDeleteDialog}
        onConfirmProfileDelete={() => void confirmProfileDeletion()}
        onCloseCreateDirectory={() => {
          if (!creatingDirectory) setCreateDirectoryDialog(null)
        }}
        onUpdateCreateDirectoryName={(name) => setCreateDirectoryDialog((current) => current ? { ...current, name } : current)}
        onSubmitCreateDirectory={(event) => void submitCreateDirectory(event)}
        onCloseScriptCommand={() => setScriptCommandDialog(null)}
        onUpdateScriptCommand={(command) => setScriptCommandDialog((current) => current ? { ...current, command } : current)}
        onSubmitScriptCommand={submitScriptCommand}
        onCloseScriptExecution={closeScriptExecutionDialog}
        onStopScriptExecution={stopScriptExecution}
        onUpdateProfile={updateProfileForm}
        onSubmitProfile={(event) => void submitProfile(event)}
        onCloseSettings={closeSettingsDialog}
        onUpdateSettings={updateSettingsForm}
        onAddFileTypeExtension={addFileTypeExtension}
        onRemoveFileTypeExtension={removeFileTypeExtension}
        onResetFileTypeExtensions={resetFileTypeExtensions}
        onUpdateDefaultView={updateDefaultView}
        onUpdateTheme={updateTheme}
        onUpdateStartupProfile={updateStartupProfile}
        onUpdateStartupKind={updateStartupKind}
        onClosePreview={closePreview}
        onOpenExternalLink={(url) => {
          void window.remoteFiles.openExternalUrl(url).catch((error) => showToast('error', '无法打开链接：' + errorMessage(error)))
        }}
        onLogPreviewScroll={onLogPreviewScroll}
        onUpdateTextDraft={updateTextDraft}
        onRequestTextSave={requestTextSave}
        onConfirmTextSave={() => void confirmTextSave()}
        onCancelTextSave={cancelTextSave}
        onPreviewImageLoad={onImageLoad}
        onZoomPreviewImage={zoomImage}
        onTrustHostKey={() => void trustAndReconnect()}
        onDismissHostKey={dismissHostKey}
        onSelectAliasProfile={commandAliases.selectProfile}
        onUpdateAliasName={commandAliases.setName}
        onUpdateAliasCommand={commandAliases.setCommand}
        onSyncAliases={commandAliases.sync}
        onAddAlias={commandAliases.add}
        onConfirmAliasOverwrite={commandAliases.confirmOverwrite}
        onCancelAliasOverwrite={commandAliases.cancelOverwrite}
        onRequestAliasDelete={commandAliases.requestDelete}
        onConfirmAliasDelete={commandAliases.confirmDelete}
        onCancelAliasDelete={commandAliases.cancelDelete}
        onTrustAliasHostKey={() => void commandAliases.trustHostKey()}
        onDismissAliasHostKey={commandAliases.dismissHostKey}
      />

      {remoteEntryDeleteDialog && (
        <ConfirmationDialog
          eyebrow="远程文件操作"
          title={remoteEntryDeleteDialog.entries.length > 1
            ? `删除 ${remoteEntryDeleteDialog.entries.length} 个远程项目？`
            : remoteEntryDeleteDialog.entries[0].type === 'directory' ? '删除远程文件夹？' : '删除远程文件？'}
          details={remoteEntryDeleteDialog.entries.length > 1
            ? [
                { label: '选中项目', value: `${remoteEntryDeleteDialog.entries.length} 项` },
                {
                  label: '名称',
                  value: remoteEntryDeleteDialog.entries.slice(0, 4).map((entry) => entry.name).join('、')
                    + (remoteEntryDeleteDialog.entries.length > 4 ? ' 等' : ''),
                },
              ]
            : [
                { label: '名称', value: remoteEntryDeleteDialog.entries[0].name },
                { label: '远程路径', value: remoteEntryDeleteDialog.entries[0].path },
              ]}
          description={remoteEntryDeleteDialog.entries.length > 1
            ? '此操作无法撤销。选中的文件夹及其所有内容也会一并删除。'
            : remoteEntryDeleteDialog.entries[0].type === 'directory'
              ? '此操作无法撤销，文件夹中的所有内容也会一并删除。'
              : '此操作无法撤销，远程文件将被永久删除。'}
          tone="danger"
          confirmLabel={remoteEntryDeleteDialog.entries.length > 1
            ? `删除 ${remoteEntryDeleteDialog.entries.length} 项`
            : remoteEntryDeleteDialog.entries[0].type === 'directory' ? '删除文件夹' : '删除文件'}
          busyLabel="正在删除"
          error={remoteEntryDeleteError}
          errorLabel={remoteEntryDeleteDialog.entries.length > 1 ? '以下项目删除失败' : '删除失败'}
          busy={remoteEntryDeleting}
          onConfirm={() => void confirmRemoteEntryDeletion()}
          onCancel={cancelRemoteEntryDeletion}
        />
      )}

      {activeRemoteMove?.conflict && (
        <RemoteMoveConflictDialog
          conflict={activeRemoteMove.conflict}
          busy={activeRemoteMove.decisionPending}
          onDecision={(decision) => void decideRemoteMoveConflict(decision)}
        />
      )}
      {activeRemoteCopy?.conflict && (
        <RemoteMoveConflictDialog
          operation="copy"
          conflict={activeRemoteCopy.conflict}
          busy={activeRemoteCopy.decisionPending}
          onDecision={(decision) => void decideRemoteCopyConflict(decision)}
        />
      )}
      {remoteOperationDetailsOpen && remoteOperationSummary && (
        <RemoteMoveSummaryDialog
          operation={remoteOperationSummary.operation}
          result={remoteOperationSummary.result}
          onClose={() => setRemoteOperationDetailsOpen(false)}
        />
      )}

      {searchProfile && searchSession && searchSessionId && (
        <SearchDialog
          key={searchSessionId}
          sessionId={searchSessionId}
          profileId={searchSession.profileId}
          currentPath={searchSession.currentPath}
          fileTypeExtensions={fileTypeExtensions}
          previewOpen={Boolean(previewDialog || logPreviewDialog)}
          onClose={() => setSearchSessionId(null)}
          onMenuAction={dispatchSftpMenuAction}
        />
      )}

      {sessionChooserOpen && (
        <SessionChooser
          profiles={profiles}
          onClose={() => setSessionChooserOpen(false)}
          onCreate={createChosenSession}
        />
      )}

    </div>
  )
}
