import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, FolderOpen, FolderUp, House, Keyboard, LoaderCircle, RefreshCw, Search, Settings, Terminal, Upload } from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import type { SessionPreviewActions } from './features/files/FileSessionWorkspace'
import { useScriptExecution } from './features/files/useScriptExecution'
import { useFileMenuActions } from './features/files/useFileMenuActions'
import SessionWorkspaceView from './features/sessions/SessionWorkspaceView'
import DialogLayer from './components/DialogLayer'
import ConfirmationDialog from './components/ConfirmationDialog'
import OperationConfirmDialog from './components/OperationConfirmDialog'
import ArchiveDependencyInstallDialog from './components/ArchiveDependencyInstallDialog'
import UploadConfirmDialog from './components/UploadConfirmDialog'
import { RemoteArchiveDialogs } from './components/RemoteArchiveDialogs'
import SessionChooser from './components/SessionChooser'
import ShortcutGuideDialog from './components/ShortcutGuideDialog'
import PerformanceMonitor from './components/PerformanceMonitor'
import { useTransfers } from './hooks/useTransfers'
import { useProfileManagement } from './hooks/useProfileManagement'
import { useCommandAliases } from './hooks/useCommandAliases'
import { useRemoteOperations } from './features/remote-files/useRemoteOperations'
import { useSessionOperations } from './features/sessions/useSessionOperations'
import { usePerformanceMonitoring } from './features/performance/usePerformanceMonitoring'
import { useRemoteFileShortcuts } from './features/files/useRemoteFileShortcuts'
import { useFileListing } from './features/files/useFileListing'
import type {
  FileTypeExtensions,
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

export default function App() {
  const [sessions, setSessions] = useState<SessionTab[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionChooserOpen, setSessionChooserOpen] = useState(false)
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false)
  const [viewModeDefault, setViewModeDefault] = useState<FileViewMode>('details')
  const [performanceThresholds, setPerformanceThresholds] = useState<PerformanceThresholds>(DEFAULT_PERFORMANCE_THRESHOLDS)
  const [fileTypeExtensions, setFileTypeExtensions] = useState<FileTypeExtensions>(defaultFileTypeExtensions)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [pendingHostKeys, setPendingHostKeys] = useState<PendingHostKey[]>([])
  const [browserContextMenu, setBrowserContextMenu] = useState<BrowserContextMenuState | null>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [searchOpenSessionIds, setSearchOpenSessionIds] = useState<Set<string>>(() => new Set())
  const [workspaceOpenSessionIds, setWorkspaceOpenSessionIds] = useState<Set<string>>(() => new Set())
  const [workspaceBlockingSessionIds, setWorkspaceBlockingSessionIds] = useState<Set<string>>(() => new Set())
  const toastSequenceRef = useRef(0)
  const connectingSessionsRef = useRef(new Set<string>())
  const directoryLoadIdsRef = useRef(new Map<string, number>())
  const contextMenuAnchorRef = useRef<HTMLElement | null>(null)
  const sessionContextMenuRef = useRef<HTMLDivElement>(null)
  const previewActionsRef = useRef(new Map<string, SessionPreviewActions>())
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
  const registerPreviewActions = useCallback((sessionId: string, actions: {
    previewFile: (entry: Pick<RemoteEntry, 'name' | 'path'>, type: PreviewType) => Promise<void>
    previewLogFile: (entry: Pick<RemoteEntry, 'name' | 'path'>) => Promise<void>
  } | null) => {
    if (actions) previewActionsRef.current.set(sessionId, actions)
    else previewActionsRef.current.delete(sessionId)
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
    setProfilePinned,
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
      removeScriptSessionStates(affectedSessions.map(({ id }) => id))
      setPendingHostKeys((current) => current.filter((pending) => pending.profile.id !== profile.id))
      for (const session of affectedSessions) {
        patchSession(session.id, { status: 'disconnected', error: '服务器配置已更新', loading: false })
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
      for (const session of affectedSessions) previewActionsRef.current.delete(session.id)
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
      patchSession(event.sessionId, { status: 'disconnected', error: event.message, loading: false })
      if (activeSessionId === event.sessionId) showToast('error', `连接已断开：${event.message}`)
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
    uploadPreflight,
    uploadPreflightBusy,
    cancelUploadPreflight,
    confirmUploadPreflight,
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
    operationPreflight,
    activeOperation,
    operationBusy,
    archiveDestinationDialog,
    archiveInstallRequest,
    archiveInstallBusy,
    archiveInstallError,
    canPasteRemote,
    remoteEntryDeleteDialog,
    remoteEntryDeleteError,
    remoteEntryDeleting,
    createDirectoryDialog,
    setCreateDirectoryDialog,
    creatingDirectory,
    submitCreateDirectory,
    requestRemoteEntriesDeletion,
    cancelRemoteEntryDeletion,
    confirmRemoteEntryDeletion,
    copyRemoteSelection,
    cutRemoteSelection,
    beginRemoteMove,
    pasteRemoteEntries,
    confirmRemoteOperation,
    cancelActiveOperation,
    extractRemoteArchive,
    beginArchiveExtractionAt,
    confirmArchiveDependencyInstall,
    cancelArchiveDependencyInstall,
    createArchiveDestinationDirectory,
    setArchiveDestinationDialog,
  } = useRemoteOperations({
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
  })

  const pendingHostKey = pendingHostKeys[0] ?? null
  const {
    startupConnectionAttempted,
    openSession,
    createChosenSession,
    duplicateSession,
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
    previewActionsRef,
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
    previewActionsRef,
    scriptExecution: { runScript, requestScriptCommandEdit },
    transfers: { download, uploadFiles },
    remoteOperations: {
      copyRemoteSelection,
      cutRemoteSelection,
      pasteRemoteEntries,
      requestRemoteEntriesDeletion,
      setCreateDirectoryDialog,
      extractRemoteArchive,
    },
    locateSearchResult,
    patchSession,
    showToast,
  })
  const modalOpen = Boolean(
    profileDialog || profileDeleteDialog || createDirectoryDialog || settingsForm
      || pendingHostKey || commandAliases.pendingHostKey || commandAliases.overwriteConfirmation
      || commandAliases.deleteConfirmation || remoteEntryDeleteDialog || operationPreflight || archiveInstallRequest || uploadPreflight
      || archiveDestinationDialog
      || (activeSessionId && workspaceBlockingSessionIds.has(activeSessionId))
      || sessionChooserOpen || shortcutGuideOpen,
  )

  useRemoteFileShortcuts({
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
    openPasteStrategyMenu: () => {
      const anchor = document.querySelector<HTMLElement>('.file-browser-content') ?? document.body
      openDirectoryContextMenu(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2), anchor)
    },
    copyRemoteSelection,
    cutRemoteSelection,
    pasteRemoteEntries,
  })

  const openSearch = () => {
    if (activeSession?.kind === 'files' && activeSession.status === 'connected') setSearchOpen(activeSession.id, true)
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

  const reportTerminalError = useCallback((message: string) => {
    showToast('error', '终端操作失败：' + message)
  }, [showToast])

  if (!profileDataLoaded
    || (startupConnection && !startupConnectionAttempted && sessions.length === 0)) {
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
                state={performanceMonitorStates[connectedSessionId] ?? null}
                thresholds={performanceThresholds}
                open={performancePanelOpen}
                onOpenChange={setPerformancePanelOpen}
                onRefresh={refreshPerformance}
              />
            )}
            {activeSession?.kind === 'files' && connectedSessionId ? (
              <>
                <button className="icon-button toolbar-button" title="搜索文件（Ctrl+F）" aria-label="搜索文件（Ctrl+F）" onClick={openSearch}>
                  <Search size={16} />
                </button>
                <button className="icon-button toolbar-button" title="新建 SSH 终端" aria-label="新建 SSH 终端" onClick={openTerminalForCurrentPath}>
                  <Terminal size={16} />
                </button>
                <button className="text-button upload-button" title="上传文件到当前目录" aria-label="上传文件到当前目录" onClick={() => uploadFiles()}>
                  <Upload size={15} /> 上传文件
                </button>
                <button className="text-button upload-button" title="上传文件夹到当前目录" aria-label="上传文件夹到当前目录" onClick={() => uploadFolder()}>
                  <FolderUp size={15} /> 上传文件夹
                </button>
                <button className="icon-button toolbar-button" title="刷新目录" aria-label="刷新目录" disabled={loading} onClick={() => void loadDirectory(connectedSessionId, currentPath)}>
                  <RefreshCw className={loading ? 'spin' : ''} size={17} />
                </button>
              </>
            ) : activeSession?.kind === 'terminal' && connectedSessionId ? (
              <button className="text-button" onClick={openFileForCurrentProfile}><FolderOpen size={15} /> 文件管理</button>
            ) : activeSession?.status === 'disconnected' ? (
              <button className="text-button" onClick={() => reconnectSession(activeSession.id)}><RefreshCw size={14} /> 重连</button>
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
            operationStatus: activeOperation && activeSession?.id === activeOperation.sessionId ? activeOperation.operation : null,
            highlightedPath,
            sessionContextMenu,
            browserContextMenu,
            searchOpenSessionIds,
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
              activateSession,
              reconnectSession,
              navigate,
            },
            remoteFiles: {
              requestRemoteEntriesDeletion,
              beginRemoteMove,
              cancelActiveOperation,
              extractRemoteArchive,
            },
            browser: {
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
              onRegisterPreviewActions: registerPreviewActions,
              onCloseScriptCommand: closeScriptCommandDialog,
              onUpdateScriptCommand: updateScriptCommand,
              onSubmitScriptCommand: submitScriptCommand,
              onCloseScriptExecution: closeScriptExecutionDialog,
              onStopScriptExecution: stopScriptExecution,
              onMenuAction: dispatchFileMenuAction,
              onOpenExternalLink: (url) => {
                void window.remoteFiles.openExternalUrl(url).catch((error) => showToast('error', '无法打开链接：' + errorMessage(error)))
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

      <GlobalToast notice={toast} onDismiss={dismissToast} />

      {shortcutGuideOpen && <ShortcutGuideDialog onClose={closeShortcutGuide} />}

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

      {operationPreflight && !archiveInstallRequest && <OperationConfirmDialog
        preflight={operationPreflight}
        busy={operationBusy}
        onConfirm={(strategy) => void confirmRemoteOperation(strategy)}
        onCancel={cancelActiveOperation}
      />}

      {archiveInstallRequest && <ArchiveDependencyInstallDialog
        dependencies={archiveInstallRequest.dependencies}
        busy={archiveInstallBusy}
        error={archiveInstallError}
        onInstall={(password) => void confirmArchiveDependencyInstall(password)}
        onCancel={cancelArchiveDependencyInstall}
      />}

      {uploadPreflight && <UploadConfirmDialog
        preflight={uploadPreflight}
        busy={uploadPreflightBusy}
        onConfirm={(strategy) => void confirmUploadPreflight(strategy)}
        onCancel={cancelUploadPreflight}
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
