import { type MessageValue, msg, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Cloud, FolderOpen, FolderUp, House, Keyboard, LoaderCircle, RefreshCw, Search, Settings, Shield, Terminal, Upload } from 'lucide-react'
import GlobalToast from './GlobalToast'
import type { SessionFileWorkspaceActions } from './features/files/FileSessionWorkspace'
import { useScriptExecution } from './features/files/useScriptExecution'
import { useFileMenuActions } from './features/files/useFileMenuActions'
import SessionWorkspaceView from './features/sessions/SessionWorkspaceView'
import DialogLayer from './components/DialogLayer'
import ConfirmationDialog from './components/ConfirmationDialog'
import FileRootPasswordDialog from './components/dialogs/FileRootPasswordDialog'
import UploadConfirmDialog from './components/UploadConfirmDialog'
import { RemoteArchiveDialogs } from './components/RemoteArchiveDialogs'
import RemoteEntryRenameDialog from './components/RemoteEntryRenameDialog'
import RemoteEntryPropertiesDialog from './components/RemoteEntryPropertiesDialog'
import SessionChooser from './components/SessionChooser'
import ShortcutGuideDialog from './components/ShortcutGuideDialog'
import PerformanceMonitor from './components/PerformanceMonitor'
import { useTransfers } from './hooks/useTransfers'
import { useToasts } from './hooks/useToasts'
import { useProfileManagement } from './hooks/useProfileManagement'
import { useCommandAliases } from './hooks/useCommandAliases'
import { useRemoteOperations } from './features/remote-files/useRemoteOperations'
import { useSessionOperations } from './features/sessions/useSessionOperations'
import { usePerformanceMonitoring } from './features/performance/usePerformanceMonitoring'
import { useRemoteFileShortcuts } from './features/files/useRemoteFileShortcuts'
import { useFileListing } from './features/files/useFileListing'
import type {
  AppSettings,
  FileTypeExtensions,
  FileIdentity,
  PerformanceThresholds,
  RemoteEntry,
  ServerProfile,
} from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { DEFAULT_PERFORMANCE_THRESHOLDS, defaultFileTypeExtensions } from '@shared/app-settings'
import type {
  BrowserContextMenu as BrowserContextMenuState,
  FileViewMode,
  PendingHostKey,
  RecentConnection,
  SessionTab,
  SessionContextMenuState,
} from './app-types'
import {
  connectFailureText,
  errorMessage,
  readRecentConnections,
} from './app-utils'

export default function App({ initialSettings }: { initialSettings: AppSettings }) {
  useLanguage()
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionChooserOpen, setSessionChooserOpen] = useState(false)
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false)
  const [entryProperties, setEntryProperties] = useState<{ sessionId: string; path: string; anchor: HTMLElement | null } | null>(null)
  const [rootRequest, setRootRequest] = useState<{
    sessionId: string
    phase: 'entering' | 'password' | 'verifying' | 'leaving'
    error?: MessageValue
  } | null>(null)
  const [viewModeDefault, setViewModeDefault] = useState<FileViewMode>('details')
  const [performanceThresholds, setPerformanceThresholds] = useState<PerformanceThresholds>(DEFAULT_PERFORMANCE_THRESHOLDS)
  const [fileTypeExtensions, setFileTypeExtensions] = useState<FileTypeExtensions>(defaultFileTypeExtensions)
  const { notices, showToast, dismissToast } = useToasts()
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [pendingHostKeys, setPendingHostKeys] = useState<PendingHostKey[]>([])
  const [browserContextMenu, setBrowserContextMenu] = useState<BrowserContextMenuState | null>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [searchOpenSessionIds, setSearchOpenSessionIds] = useState<Set<string>>(() => new Set())
  const [workspaceOpenSessionIds, setWorkspaceOpenSessionIds] = useState<Set<string>>(() => new Set())
  const [workspaceBlockingSessionIds, setWorkspaceBlockingSessionIds] = useState<Set<string>>(() => new Set())
  const connectingSessionsRef = useRef(new Set<string>())
  const directoryLoadIdsRef = useRef(new Map<string, number>())
  const contextMenuAnchorRef = useRef<HTMLElement | null>(null)
  const sessionContextMenuRef = useRef<HTMLDivElement>(null)
  const workspaceActionsRef = useRef(new Map<string, SessionFileWorkspaceActions>())
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
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )
  const sessionIds = useMemo(() => new Set(sessions.map((session) => session.id)), [sessions])
  const {
    scriptCommandDialogs,
    scriptExecutionDialogs,
    requestScriptCommandEdit,
    runScript,
    updateScriptCommand,
    closeScriptCommandDialog,
    submitScriptCommand,
    closeScriptExecutionDialog,
    stopScriptExecution,
    removeSessionStates: removeScriptSessionStates,
  } = useScriptExecution({ activeSessionId: activeSession?.id, sessionsRef, setBrowserContextMenu, showToast })
  const connectedProfileId = activeSession?.status === 'connected' ? activeSession.profileId : null
  const connectedSessionId = connectedProfileId ? activeSessionId : null
  const {
    currentPath,
    entries,
    loading,
    viewMode,
    sort,
    highlightedPath,
    breadcrumbs,
    sortedEntries,
    toggleSort,
  } = useFileListing({ activeSession, viewModeDefault, patchSession })
  const {
    states: performanceMonitorStates,
    panelOpen: performancePanelOpen,
    setPanelOpen: setPerformancePanelOpen,
    removeSessionStates: removeSessionPerformanceState,
    refresh: refreshPerformance,
  } = usePerformanceMonitoring({ connectedSessionId, sessionsRef, showToast })
  const setSearchOpen = useCallback((sessionId: string, open: boolean) => {
    setSearchOpenSessionIds((current) => {
      if (current.has(sessionId) === open) return current
      const next = new Set(current)
      if (open) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])
  const setWorkspaceBlocking = useCallback((sessionId: string, blocking: boolean) => {
    setWorkspaceBlockingSessionIds((current) => {
      if (current.has(sessionId) === blocking) return current
      const next = new Set(current)
      if (blocking) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])
  const setWorkspaceOpen = useCallback((sessionId: string, open: boolean) => {
    setWorkspaceOpenSessionIds((current) => {
      if (current.has(sessionId) === open) return current
      const next = new Set(current)
      if (open) next.add(sessionId)
      else next.delete(sessionId)
      return next
    })
  }, [])
  const registerWorkspaceActions = useCallback((sessionId: string, actions: SessionFileWorkspaceActions | null) => {
    if (actions) workspaceActionsRef.current.set(sessionId, actions)
    else workspaceActionsRef.current.delete(sessionId)
  }, [])
  const removeSessionWorkspaceState = useCallback((sessionIds: string[]) => {
    setSearchOpenSessionIds((current) => {
      const next = new Set(current)
      for (const sessionId of sessionIds) next.delete(sessionId)
      return next
    })
    setWorkspaceBlockingSessionIds((current) => {
      const next = new Set(current)
      for (const sessionId of sessionIds) next.delete(sessionId)
      return next
    })
    setWorkspaceOpenSessionIds((current) => {
      const next = new Set(current)
      for (const sessionId of sessionIds) next.delete(sessionId)
      return next
    })
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
    setProfilePinned,
    updateSettingsForm,
    addFileTypeExtension,
    removeFileTypeExtension,
    resetFileTypeExtensions,
    updateDefaultView,
    updateTheme,
    updateLanguage,
    updateStartupProfile,
    updateStartupKind,
    closeProfileDialog,
    closeSettingsDialog,
  } = useProfileManagement({
    initialSettings,
    showToast,
    onProfileSaved: (profile) => {
      const affectedSessions = sessionsRef.current.filter((session) => session.profileId === profile.id)
      removeScriptSessionStates(affectedSessions.map(({ id }) => id))
      setPendingHostKeys((current) => current.filter((pending) => pending.profile.id !== profile.id))
      for (const session of affectedSessions) {
        patchSession(session.id, { status: 'disconnected', error: msg('errors.serverConfigurationUpdated'), loading: false })
      }
      removeSessionWorkspaceState(affectedSessions.map(({ id }) => id))
    },
    onProfileDeleted: (profileId) => {
      setRecentConnections((current) => current.filter((connection) => connection.profileId !== profileId))
      const affectedSessions = sessionsRef.current.filter((session) => session.profileId === profileId)
      removeScriptSessionStates(affectedSessions.map(({ id }) => id))
      setPendingHostKeys((current) => current.filter((pending) => pending.profile.id !== profileId))
      const remaining = sessionsRef.current.filter((session) => session.profileId !== profileId)
      sessionsRef.current = remaining
      setSessions(remaining)
      for (const session of affectedSessions) {
        directoryLoadIdsRef.current.delete(session.id)
        connectingSessionsRef.current.delete(session.id)
      }
      removeSessionWorkspaceState(affectedSessions.map(({ id }) => id))
      removeSessionPerformanceState(affectedSessions.map(({ id }) => id))
      for (const session of affectedSessions) workspaceActionsRef.current.delete(session.id)
      if (activeSessionId && !remaining.some((session) => session.id === activeSessionId)) {
        setActiveSessionId(remaining.at(-1)?.id ?? null)
      }
    },
    onDefaultViewChange: (mode) => {
      setViewModeDefault(mode)
      setSessions((current) => current.map((session) => session.kind === 'files' ? { ...session, viewMode: mode } : session))
    },
    onFileTypeExtensionsChange: setFileTypeExtensions,
    onPerformanceThresholdsChange: setPerformanceThresholds,
  })

  const connectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeSession?.profileId) ?? null,
    [profiles, activeSession?.profileId],
  )

  const commandAliases = useCommandAliases({
    profiles,
    showToast,
  })
  const openSettings = () => {
    commandAliases.prepareForSettings(connectedProfileId)
    void openSettingsDialog()
  }
  const closeShortcutGuide = useCallback(() => setShortcutGuideOpen(false), [])
  const offlineProfiles = useMemo(
    () => {
      const connectionTimes = new Map(
        recentConnections.map((connection) => [connection.profileId, connection.connectedAt] as const),
      )
      return profiles
        .map((profile, index) => ({ profile, index, connectedAt: connectionTimes.get(profile.id) }))
        .sort((left, right) => {
          if (left.profile.pinned !== right.profile.pinned) return left.profile.pinned ? -1 : 1
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
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === event.sessionId)
      if (!session) return
      removeScriptSessionStates([event.sessionId])
      removeSessionPerformanceState([event.sessionId])
      setRootRequest((current) => current?.sessionId === event.sessionId ? null : current)
      patchSession(event.sessionId, { status: 'disconnected', error: event.message, loading: false, fileIdentity: undefined })
      if (activeSessionId === event.sessionId) showToast('error', msg('common.connectionDisconnected', { "message": event.message }))
    })
    return removeClosedListener
  }, [activeSessionId, patchSession, removeScriptSessionStates, removeSessionPerformanceState, showToast])

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

  const loadDirectory = async (sessionId: string, remotePath: string, quiet = false) => {
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
        if (!quiet && activeSessionId === sessionId) showToast('error', errorMessage(error))
      }
      return false
    }
  }

  const {
    transfers,
    uploadSelection,
    cancelUploadSelection,
    confirmUploadSelection,
    cancelTransfer: cancelTransferJob,
    uploadFiles,
    uploadFolder,
    uploadDroppedEntries,
    download,
    dismissTransfer,
  } = useTransfers({
    activeSessionId,
    sessionIds,
    sessionId: connectedSessionId,
    currentPath,
    profileName: connectedProfile?.name ?? '',
    loadDirectory,
    showToast,
  })

  const {
    activeOperation,
    archiveDestinationDialog,
    canPasteRemote,
    remoteEntryDeleteDialog,
    remoteEntryDeleteError,
    remoteEntryDeleting,
    createDirectoryDialog,
    setCreateDirectoryDialog,
    creatingDirectory,
    submitCreateDirectory,
    renameEntryDialog,
    requestRemoteEntryRename,
    cancelRemoteEntryRename,
    submitRemoteEntryRename,
    requestRemoteEntriesDeletion,
    cancelRemoteEntryDeletion,
    confirmRemoteEntryDeletion,
    copyRemoteSelection,
    cutRemoteSelection,
    beginRemoteMove,
    pasteRemoteEntries,
    cancelActiveOperation,
    extractRemoteArchive,
    beginArchiveExtractionAt,
    createArchiveDestinationDirectory,
    setArchiveDestinationDialog,
  } = useRemoteOperations({
    activeSession,
    connectedProfile,
    connectedSessionId,
    currentPath,
    sessionsRef,
    updateSession,
    loadDirectory,
    showToast,
    setBrowserContextMenu,
  })

  const applyFileIdentity = async (sessionId: string, identity: FileIdentity) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session?.status !== 'connected') return
    patchSession(sessionId, { fileIdentity: identity, entries: [], selectedPaths: [], highlightedPath: null })
    setSearchOpen(sessionId, false)
    closeScriptCommandDialog(sessionId)
    if (activeSessionId === sessionId) {
      setBrowserContextMenu(null)
      setCreateDirectoryDialog(null)
    }
    setEntryProperties((current) => current?.sessionId === sessionId ? null : current)
    if (renameEntryDialog?.sessionId === sessionId) cancelRemoteEntryRename()
    if (remoteEntryDeleteDialog?.sessionId === sessionId) cancelRemoteEntryDeletion()
    if (archiveDestinationDialog?.sessionId === sessionId) setArchiveDestinationDialog(null)
    if (uploadSelection?.sessionId === sessionId) cancelUploadSelection()
    if (identity === 'login' && session.currentPath !== '/') {
      if (await loadDirectory(sessionId, session.currentPath, true)) return
      if (await loadDirectory(sessionId, '/')) patchSession(sessionId, { history: ['/'], historyIndex: 0 })
    } else {
      await loadDirectory(sessionId, session.currentPath)
    }
  }

  const handleRootExpired = useEffectEvent((event: { sessionId: string; remoteStateUnknown: boolean }) => {
    showToast('error', event.remoteStateUnknown
      ? msg('common.sudoPrivilegesExpiredRootModeEndedSomeRemoteTaskStates')
      : msg('common.sudoPrivilegesExpiredRootModeEnded'))
    void applyFileIdentity(event.sessionId, 'login')
  })
  useEffect(() => window.remoteFiles.onFileRootExpired((event) => handleRootExpired(event)), [])

  const enterFileRoot = async (sessionId: string, password?: string) => {
    setRootRequest({ sessionId, phase: password === undefined ? 'entering' : 'verifying' })
    try {
      const result = await window.remoteFiles.enterFileRoot(sessionId, password)
      if (result.status === 'password-required') {
        setRootRequest({ sessionId, phase: 'password' })
        return
      }
      if (result.status === 'entered') await applyFileIdentity(sessionId, result.identity)
    } catch (error) {
      if (password !== undefined) {
        setRootRequest({ sessionId, phase: 'password', error: errorMessage(error) })
        return
      }
      showToast('error', errorMessage(error))
    }
    setRootRequest(null)
  }

  const leaveFileRoot = async (sessionId: string) => {
    setRootRequest({ sessionId, phase: 'leaving' })
    try {
      const { remoteStateUnknown } = await window.remoteFiles.leaveFileRoot(sessionId)
      if (remoteStateUnknown) showToast('info', msg('common.rootModeEndedSomeRemoteTaskStatesAreUnknown'))
      await applyFileIdentity(sessionId, 'login')
    } catch (error) {
      showToast('error', errorMessage(error))
    } finally {
      setRootRequest(null)
    }
  }

  const pendingHostKey = pendingHostKeys[0] ?? null
  const {
    startupConnectionAttempted,
    openSession,
    createChosenSession,
    duplicateSession,
    reorderSession,
    openSessionContextMenu,
    handleSessionTabContextMenuKeyDown,
    reconnectSession,
    closeSession,
    activateSession,
    goHome,
    navigateSession,
    navigate,
    locateSearchResult,
    movePathHistory,
    trustAndReconnect,
    dismissHostKey,
  } = useSessionOperations({
    sessions,
    sessionsRef,
    profiles,
    activeSessionId,
    activeSession,
    viewModeDefault,
    pendingHostKey,
    startupConnection,
    profileDataLoaded,
    setSessions,
    setActiveSessionId,
    setPendingHostKeys,
    setRecentConnections,
    setBrowserContextMenu,
    setSessionContextMenu,
    setSessionChooserOpen,
    setCreateDirectoryDialog,
    patchSession,
    updateSession,
    loadDirectory,
    removeSessionWorkspaceState,
    removeSessionScriptStates: removeScriptSessionStates,
    removeSessionPerformanceState,
    workspaceActionsRef,
    directoryLoadIdsRef,
    connectingSessionsRef,
    setSearchOpen,
    showToast,
  })
  const { openEntryContextMenu, openDirectoryContextMenu, dispatchFileMenuAction } = useFileMenuActions({
    activeSession,
    connectedSessionId,
    currentPath,
    sort,
    canPasteRemote,
    setBrowserContextMenu,
    setSessionContextMenu,
    contextMenuAnchorRef,
    setSearchOpen,
    workspaceActionsRef,
    scriptExecution: { runScript, requestScriptCommandEdit },
    transfers: { download, uploadFiles },
    remoteOperations: {
      copyRemoteSelection,
      cutRemoteSelection,
      pasteRemoteEntries,
      requestRemoteEntriesDeletion,
      requestRemoteEntryRename,
      setCreateDirectoryDialog,
      extractRemoteArchive,
    },
    locateSearchResult,
    openEntryProperties: (sessionId, path) => setEntryProperties({ sessionId, path, anchor: contextMenuAnchorRef.current }),
    patchSession,
    showToast,
  })
  const modalOpen = Boolean(
    profileDialog || profileDeleteDialog || createDirectoryDialog || renameEntryDialog || entryProperties || settingsForm
      || pendingHostKey || commandAliases.pendingHostKey || commandAliases.overwriteConfirmation
      || commandAliases.deleteConfirmation || remoteEntryDeleteDialog || uploadSelection
      || archiveDestinationDialog || rootRequest?.phase === 'password' || rootRequest?.phase === 'verifying'
      || (activeSessionId && workspaceBlockingSessionIds.has(activeSessionId))
      || sessionChooserOpen || shortcutGuideOpen,
  )

  const refreshDirectory = () => {
    if (connectedSessionId) void loadDirectory(connectedSessionId, currentPath)
  }

  useRemoteFileShortcuts({
    activeSession,
    activeSessionId,
    modalOpen,
    workspaceOpenSessionIds,
    browserContextMenu,
    sessionContextMenu,
    sortedEntries,
    canPasteRemote,
    onRefresh: refreshDirectory,
    onSelectedPathsChange: (selectedPaths) => {
      if (activeSession) patchSession(activeSession.id, { selectedPaths })
    },
    copyRemoteSelection,
    cutRemoteSelection,
    pasteRemoteEntries: () => pasteRemoteEntries(currentPath, 'force'),
  })

  const openSearch = () => {
    if (activeSession?.kind === 'files' && activeSession.status === 'connected') workspaceActionsRef.current.get(activeSession.id)?.requestSearch()
  }

  const openTerminalForCurrentPath = () => {
    if (!connectedProfile || activeSession?.kind !== 'files') return
    openSession(connectedProfile, 'terminal', currentPath)
  }

  const openFileForCurrentProfile = () => {
    if (!activeSession || activeSession.kind !== 'terminal') return
    const existingSession = sessionsRef.current.find((session) =>
      session.profileId === activeSession.profileId && session.kind === 'files')
    if (existingSession) {
      activateSession(existingSession.id)
      return
    }
    if (connectedProfile) openSession(connectedProfile, 'files')
  }

  const reportTerminalError = useCallback((message: MessageValue) => {
    showToast('error', msg('common.terminalOperationFailed', { "message": message }))
  }, [showToast])

  if (!profileDataLoaded
    || (startupConnection && !startupConnectionAttempted && sessions.length === 0)) {
    return (
      <div className="app-shell startup-shell">
        <main className="main-area">
          <div className="startup-loading" role="status" aria-label={tr('common.starting')}>
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
              title={tr('common.home')}
              aria-label={tr('common.home')}
              disabled={!activeSession}
              onClick={goHome}
            >
              <House size={16} />
            </button>
            <button
              className="icon-button toolbar-button"
              title={tr('common.settings')}
              aria-label={tr('common.settings')}
              disabled={settingsLoading}
              onClick={openSettings}
            >
              <Settings size={16} />
            </button>
            <button
              className="icon-button toolbar-button"
              title={tr('common.keyboardShortcuts')}
              aria-label={tr('common.keyboardShortcuts')}
              onClick={() => setShortcutGuideOpen(true)}
            >
              <Keyboard size={16} />
            </button>
            {connectedProfile && <span className="topbar-separator" />}
            {connectedProfile && <span className="connected-host"><Cloud size={14} /> {connectedProfile.username}@{connectedProfile.host}</span>}
            {activeSession && activeSession.status !== 'connected' && (
              <span className={'active-session-status ' + activeSession.status}>
                {activeSession.status === 'connecting' ? tr('common.connecting')
                  : activeSession.status === 'awaiting-trust' ? tr('common.awaitingFingerprintVerification')
                    : tr('common.disconnected')}
              </span>
            )}
          </div>
          <div className="topbar-actions">
            {connectedSessionId && (
              <PerformanceMonitor
                state={performanceMonitorStates[connectedSessionId] ?? null}
                thresholds={performanceThresholds}
                open={performancePanelOpen}
                onOpenChange={setPerformancePanelOpen}
                onRefresh={refreshPerformance}
              />
            )}
            {activeSession?.kind === 'files' && connectedSessionId ? (
              <>
                {activeSession.fileIdentity === 'root-login' ? (
                  <span className="file-root-identity" role="status">{tr('common.rootLogin')}</span>
                ) : (
                  <button
                    className={'text-button' + (activeSession.fileIdentity === 'sudo-root' ? ' file-root-identity' : '')}
                    disabled={rootRequest !== null && !(rootRequest.phase === 'entering' && rootRequest.sessionId === connectedSessionId)}
                    onClick={() => {
                      if (rootRequest?.phase === 'entering') {
                        void window.remoteFiles.cancelFileRootEntry(connectedSessionId).catch((error) => showToast('error', errorMessage(error)))
                      } else if (activeSession.fileIdentity === 'sudo-root') void leaveFileRoot(connectedSessionId)
                      else void enterFileRoot(connectedSessionId)
                    }}
                  >
                    <Shield size={15} />
                    {rootRequest?.sessionId === connectedSessionId && rootRequest.phase === 'entering' ? tr('common.cancelElevation')
                      : rootRequest?.sessionId === connectedSessionId && rootRequest.phase === 'leaving' ? tr('common.leavingRootMode')
                        : activeSession.fileIdentity === 'sudo-root' ? tr('common.leaveRootMode') : tr('common.enterRootMode')}
                  </button>
                )}
                <button className="icon-button toolbar-button" title={tr('common.searchFiles')} aria-label={tr('common.searchFiles')} onClick={openSearch}>
                  <Search size={16} />
                </button>
                <button className="icon-button toolbar-button" title={tr('common.newSshTerminal')} aria-label={tr('common.newSshTerminal')} onClick={openTerminalForCurrentPath}>
                  <Terminal size={16} />
                </button>
                <button className="text-button upload-button" title={tr('common.uploadFilesToTheCurrentDirectory')} aria-label={tr('common.uploadFilesToTheCurrentDirectory')} onClick={() => uploadFiles()}>
                  <Upload size={15} />{tr('common.uploadFiles')}</button>
                <button className="text-button upload-button" title={tr('common.uploadAFolderToTheCurrentDirectory')} aria-label={tr('common.uploadAFolderToTheCurrentDirectory')} onClick={() => uploadFolder()}>
                  <FolderUp size={15} />{tr('common.uploadFolder')}</button>
                <button className="icon-button toolbar-button" title={tr('common.refreshDirectoryF5')} aria-label={tr('common.refreshDirectory')} aria-keyshortcuts="F5" disabled={loading} onClick={refreshDirectory}>
                  <RefreshCw className={loading ? 'spin' : ''} size={17} />
                </button>
              </>
            ) : activeSession?.kind === 'terminal' && connectedSessionId ? (
              <button className="text-button" onClick={openFileForCurrentProfile}><FolderOpen size={15} />{tr('common.fileManager')}</button>
            ) : activeSession?.status === 'disconnected' ? (
              <button className="text-button" onClick={() => reconnectSession(activeSession.id)}><RefreshCw size={14} />{tr('common.reconnect')}</button>
            ) : activeSession?.status === 'connecting' ? <LoaderCircle className="spin" size={17} /> : null}
          </div>
        </header>

        <SessionWorkspaceView
          state={{
            sessions,
            profiles,
            offlineProfiles,
            activeSession,
            activeSessionId,
            connectedSessionId,
            currentPath,
            entries,
            loading,
            viewMode,
            breadcrumbs,
            sort,
            sortedEntries,
            operationActive: activeOperation !== null,
            highlightedPath,
            sessionContextMenu,
            browserContextMenu,
            searchOpenSessionIds,
            entryPropertiesSessionId: entryProperties?.sessionId ?? null,
            scriptCommandDialogs,
            scriptExecutionDialogs,
            fileTypeExtensions,
            transfers,
          }}
          actions={{
            sessions: {
              closeSession,
              openSessionContextMenu,
              handleSessionTabContextMenuKeyDown,
              duplicateSession,
              reorderSession,
              activateSession,
              reconnectSession,
              navigate,
            },
            remoteFiles: {
              requestRemoteEntriesDeletion,
              beginRemoteMove,
              extractRemoteArchive,
            },
            browser: {
              onOpenFile: (entry) => workspaceActionsRef.current.get(activeSession!.id)!.openFile(entry),
              onOpenEntryContextMenu: openEntryContextMenu,
              onOpenDirectoryContextMenu: openDirectoryContextMenu,
              onDropUpload: uploadDroppedEntries,
              onDropError: (error) => showToast('error', errorMessage(error)),
            },
            serverList: {
              onAdd: () => openProfileDialog('create'),
              onConnect: openSession,
              onEdit: (profile) => openProfileDialog('edit', profile),
              onSetPinned: (profile, pinned) => void setProfilePinned(profile.id, pinned),
              onDelete: requestProfileDeletion,
            },
            terminal: {
              onReconnect: reconnectSession,
              onError: reportTerminalError,
            },
            fileWorkspace: {
              showToast,
              onSearchOpenChange: setSearchOpen,
              onWorkspaceOpenChange: setWorkspaceOpen,
              onBlockingChange: setWorkspaceBlocking,
              onRegisterWorkspaceActions: registerWorkspaceActions,
              onCloseScriptCommand: closeScriptCommandDialog,
              onUpdateScriptCommand: updateScriptCommand,
              onSubmitScriptCommand: submitScriptCommand,
              onCloseScriptExecution: closeScriptExecutionDialog,
              onStopScriptExecution: stopScriptExecution,
              onMenuAction: dispatchFileMenuAction,
              onOpenExternalLink: (url) => {
                void window.remoteFiles.openExternalUrl(url).catch((error) => showToast('error', msg('common.cannotOpenLink', { "value1": errorMessage(error) })))
              },
            },
            loadDirectory,
            setSessionChooserOpen,
            onCancelTransfer: cancelTransferJob,
            onDismissTransfer: dismissTransfer,
            onCloseBrowserContextMenu: () => setBrowserContextMenu(null),
            patchSession,
            toggleSort,
          }}
          sessionContextMenuRef={sessionContextMenuRef}
          contextMenuAnchorRef={contextMenuAnchorRef}
        />
      </main>

      <GlobalToast
        notices={notices}
        onDismiss={dismissToast}
        progress={activeOperation ? {
          message: msg('common.message', { "value1": activeOperation.operation === 'copy' ? msg('common.copy') : activeOperation.operation === 'move' ? msg('common.move') : msg('common.extract') }),
          onCancel: cancelActiveOperation,
        } : null}
      />

      {shortcutGuideOpen && <ShortcutGuideDialog onClose={closeShortcutGuide} />}
      {rootRequest && (rootRequest.phase === 'password' || rootRequest.phase === 'verifying') && (
        <FileRootPasswordDialog
          busy={rootRequest.phase === 'verifying'}
          error={rootRequest.error}
          onSubmit={(password) => void enterFileRoot(rootRequest.sessionId, password)}
          onCancel={() => setRootRequest(null)}
        />
      )}

      <DialogLayer
        profileDialog={profileDialog}
        profileDeleteDialog={profileDeleteDialog}
        profileDeleteError={profileDeleteError}
        profileDeleting={profileDeleting}
        createDirectoryDialog={createDirectoryDialog}
        creatingDirectory={creatingDirectory}
        settingsForm={settingsForm}
        profiles={profiles}
        pendingHostKey={pendingHostKey}
        pendingAliasHostKey={commandAliases.pendingHostKey}
        aliasSnapshot={commandAliases.snapshot}
        aliasProfileId={commandAliases.selectedProfileId}
        aliasOperationBusy={commandAliases.operation !== null}
        aliasName={commandAliases.name}
        aliasCommand={commandAliases.command}
        aliasOverwriteConfirmation={commandAliases.overwriteConfirmation}
        aliasDeleteConfirmation={commandAliases.deleteConfirmation}
        onCloseProfile={closeProfileDialog}
        onCloseProfileDelete={closeProfileDeleteDialog}
        onConfirmProfileDelete={() => void confirmProfileDeletion()}
        onCloseCreateDirectory={() => {
          if (!creatingDirectory) setCreateDirectoryDialog(null)
        }}
        onUpdateCreateDirectoryName={(name) => setCreateDirectoryDialog((current) => current ? { ...current, name } : current)}
        onSubmitCreateDirectory={(event) => void submitCreateDirectory(event)}
        onUpdateProfile={updateProfileForm}
        onSubmitProfile={(event) => void submitProfile(event)}
        onCloseSettings={closeSettingsDialog}
        onUpdateSettings={updateSettingsForm}
        onAddFileTypeExtension={addFileTypeExtension}
        onRemoveFileTypeExtension={removeFileTypeExtension}
        onResetFileTypeExtensions={resetFileTypeExtensions}
        onUpdateDefaultView={updateDefaultView}
        onUpdateTheme={updateTheme}
        onUpdateLanguage={updateLanguage}
        onUpdateStartupProfile={updateStartupProfile}
        onUpdateStartupKind={updateStartupKind}
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

      {entryProperties && (
        <RemoteEntryPropertiesDialog
          sessionId={entryProperties.sessionId}
          path={entryProperties.path}
          returnFocus={entryProperties.anchor}
          onClose={() => setEntryProperties(null)}
        />
      )}
      {renameEntryDialog && (
        <RemoteEntryRenameDialog
          key={renameEntryDialog.entry.path}
          state={renameEntryDialog}
          onSubmit={submitRemoteEntryRename}
          onClose={cancelRemoteEntryRename}
        />
      )}

      {remoteEntryDeleteDialog && (
        <ConfirmationDialog
          eyebrow={tr('common.remoteFileOperation')}
          title={remoteEntryDeleteDialog.entries.length > 1
            ? tr('common.deleteRemoteItems', { "count": remoteEntryDeleteDialog.entries.length })
            : remoteEntryDeleteDialog.entries[0].type === 'directory' ? tr('common.deleteRemoteFolder') : tr('common.deleteRemoteFile')}
          details={remoteEntryDeleteDialog.entries.length > 1
            ? [
                { label: tr('common.selectedItems'), value: tr('common.items', { "count": remoteEntryDeleteDialog.entries.length }) },
                {
                  label: tr('common.name'),
                  value: remoteEntryDeleteDialog.entries.slice(0, 4).map((entry) => entry.name).join('、')
                    + (remoteEntryDeleteDialog.entries.length > 4 ? tr('common.andOthers') : ''),
                },
              ]
            : [
                { label: tr('common.name'), value: remoteEntryDeleteDialog.entries[0].name },
                { label: tr('common.remotePath'), value: remoteEntryDeleteDialog.entries[0].path },
              ]}
          description={remoteEntryDeleteDialog.entries.length > 1
            ? tr('common.thisCannotBeUndoneSelectedFoldersAndAllTheirContents')
            : remoteEntryDeleteDialog.entries[0].type === 'directory'
              ? tr('common.thisCannotBeUndoneAllContentsOfTheFolderWill')
              : tr('common.thisCannotBeUndoneTheRemoteFileWillBePermanently')}
          tone="danger"
          confirmLabel={remoteEntryDeleteDialog.entries.length > 1
            ? tr('common.deleteItems', { "count": remoteEntryDeleteDialog.entries.length })
            : remoteEntryDeleteDialog.entries[0].type === 'directory' ? tr('common.deleteFolder') : tr('common.deleteFile')}
          busyLabel={tr('common.deleting')}
          error={remoteEntryDeleteError}
          errorLabel={remoteEntryDeleteDialog.entries.length > 1 ? tr('common.theseItemsCouldNotBeDeleted') : tr('common.deletionFailed')}
          busy={remoteEntryDeleting}
          onConfirm={() => void confirmRemoteEntryDeletion()}
          onCancel={cancelRemoteEntryDeletion}
        />
      )}

      {uploadSelection && <UploadConfirmDialog
        selection={uploadSelection}
        onConfirm={() => confirmUploadSelection('force')}
        onCancel={cancelUploadSelection}
      />}

      <RemoteArchiveDialogs
        destination={archiveDestinationDialog}
        onCloseDestination={() => setArchiveDestinationDialog(null)}
        onChooseDestination={beginArchiveExtractionAt}
        onCreateDirectory={createArchiveDestinationDirectory}
      />

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
