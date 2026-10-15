import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Cloud, Copy, FolderOpen, FolderUp, House, LoaderCircle, Plus, RefreshCw, Search, Settings, Terminal, Upload, X } from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import FileBrowser from './components/FileBrowser'
import FileContextMenu from './components/FileContextMenu'
import ServerList from './components/ServerList'
import TransferTray from './components/TransferTray'
import SearchDialog from './components/SearchDialog'
import DialogLayer from './components/DialogLayer'
import ConfirmationDialog from './components/ConfirmationDialog'
import SessionChooser from './components/SessionChooser'
import TerminalPanel from './components/TerminalPanel'
import { usePreview } from './hooks/usePreview'
import { useTransfers } from './hooks/useTransfers'
import { useProfileManagement } from './hooks/useProfileManagement'
import type {
  RemoteEntry,
  RemoteSearchResult,
  ServerProfile,
  SessionKind,
  TrustHostKeyInput,
} from '@shared/types'
import type {
  BrowserContextMenu as BrowserContextMenuState,
  FileViewMode,
  PendingHostKey,
  RecentConnection,
  SessionTab,
  SortColumn,
  SortDirection,
} from './app-types'
import {
  connectFailureText,
  entryNameCollator,
  errorMessage,
  readRecentConnections,
  readDefaultView,
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
  const [viewModeDefault, setViewModeDefault] = useState<FileViewMode>(readDefaultView)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [pendingHostKeys, setPendingHostKeys] = useState<PendingHostKey[]>([])
  const [browserContextMenu, setBrowserContextMenu] = useState<BrowserContextMenuState | null>(null)
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null)
  const [remoteEntryDeleteDialog, setRemoteEntryDeleteDialog] = useState<{ entry: RemoteEntry; sessionId: string; directory: string } | null>(null)
  const [remoteEntryDeleteError, setRemoteEntryDeleteError] = useState<string | null>(null)
  const [remoteEntryDeleting, setRemoteEntryDeleting] = useState(false)
  const [createDirectoryDialog, setCreateDirectoryDialog] = useState<{ name: string } | null>(null)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [searchSessionId, setSearchSessionId] = useState<string | null>(null)
  const toastSequenceRef = useRef(0)
  const startupConnectionAttemptedRef = useRef(false)
  const connectingSessionsRef = useRef(new Set<string>())
  const directoryLoadIdsRef = useRef(new Map<string, number>())
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const sessionContextMenuRef = useRef<HTMLDivElement>(null)
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
  const showToast = useCallback((kind: ToastNotice['kind'], message: string) => {
    setToast({ id: ++toastSequenceRef.current, kind, message })
  }, [])
  const {
    previewDialog,
    logPreviewDialog,
    imageZoom,
    imagePreviewSize,
    imageViewportRef,
    previewImageRef,
    logViewportRef,
    closePreview,
    previewFile,
    previewLogFile,
    onLogPreviewScroll,
    onImageLoad,
    zoomImage,
  } = usePreview({
    sessionId: sessions.find((session) => session.id === activeSessionId)?.kind === 'sftp'
      && sessions.find((session) => session.id === activeSessionId)?.status === 'connected'
      ? activeSessionId
      : null,
    showToast,
  })
  const dismissToast = useCallback(() => setToast(null), [])
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
    settingsSaving,
    openProfileDialog,
    openSettingsDialog,
    updateProfileForm,
    submitProfile,
    requestProfileDeletion,
    closeProfileDeleteDialog,
    confirmProfileDeletion,
    updateSettingsForm,
    updateDefaultView,
    updateStartupProfile,
    updateStartupKind,
    submitSettings,
    closeProfileDialog,
    closeSettingsDialog,
  } = useProfileManagement({
    showToast,
    clearToast: dismissToast,
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
  })

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  )
  const connectedProfileId = activeSession?.status === 'connected' ? activeSession.profileId : null
  const connectedSessionId = connectedProfileId ? activeSessionId : null
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
  const searchSession = useMemo(
    () => sessions.find((session) => session.id === searchSessionId) ?? null,
    [sessions, searchSessionId],
  )
  const searchProfile = useMemo(
    () => profiles.find((profile) => profile.id === searchSession?.profileId) ?? null,
    [profiles, searchSession?.profileId],
  )
  const pendingHostKey = pendingHostKeys[0] ?? null
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
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f'
        || activeSession?.kind !== 'sftp' || activeSession.status !== 'connected') return
      event.preventDefault()
      if (!searchSessionId) setSearchSessionId(activeSession.id)
    }
    window.addEventListener('keydown', openSearchShortcut)
    return () => window.removeEventListener('keydown', openSearchShortcut)
  }, [activeSession, searchSessionId])

  useEffect(() => {
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === event.sessionId)
      if (!session) return
      patchSession(event.sessionId, { status: 'disconnected', error: event.message, loading: false })
      if (activeSessionId === event.sessionId) showToast('error', `连接已断开：${event.message}`)
    })
    return removeClosedListener
  }, [activeSessionId, patchSession, showToast])

  useEffect(() => {
    if (!browserContextMenu) return

    const dismissOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setBrowserContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBrowserContextMenu(null)
    }
    const dismiss = () => setBrowserContextMenu(null)

    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    contextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-haspopup="menu"])')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [browserContextMenu])

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
      patchSession(sessionId, { entries: nextEntries, currentPath: remotePath, loading: false })
      if (activeSessionId === sessionId) setToast(null)
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
    setToast(null)
    void connectSession(session, profile)
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

  const locateSearchResult = async (result: RemoteSearchResult) => {
    const sessionId = searchSessionId
    setSearchSessionId(null)
    if (!sessionId) return
    activateSession(sessionId)
    const destination = result.type === 'directory' ? result.path : getParentPath(result.path)
    const loaded = await navigateSession(sessionId, destination)
    if (loaded) patchSession(sessionId, { highlightedPath: result.type === 'directory' ? null : result.path })
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
    const itemCount = menu.kind === 'directory' ? 4 : menu.entry.type === 'file' ? 4 : 3
    const menuWidth = 204
    const menuHeight = itemCount * 34 + 14
    setSessionContextMenu(null)
    setBrowserContextMenu({
      ...menu,
      x: Math.max(8, Math.min(menu.x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(menu.y, window.innerHeight - menuHeight - 8)),
    })
  }

  const openEntryContextMenu = (entry: RemoteEntry, x: number, y: number) => {
    if (entry.type !== 'file' && entry.type !== 'directory') return
    openBrowserContextMenu({
      kind: 'entry',
      entry,
      x,
      y,
    })
  }

  const openDirectoryContextMenu = (x: number, y: number) => {
    openBrowserContextMenu({ kind: 'directory', x, y })
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
  const copyCurrentPath = () => copyPath(currentPath)

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

  const requestRemoteEntryDeletion = (entry: RemoteEntry) => {
    if (!connectedSessionId) return
    setBrowserContextMenu(null)
    setRemoteEntryDeleteError(null)
    setRemoteEntryDeleteDialog({ entry, sessionId: connectedSessionId, directory: currentPath })
  }

  const cancelRemoteEntryDeletion = () => {
    if (remoteEntryDeleting) return
    setRemoteEntryDeleteDialog(null)
    setRemoteEntryDeleteError(null)
  }

  const confirmRemoteEntryDeletion = async () => {
    if (!remoteEntryDeleteDialog || remoteEntryDeleting) return
    const { entry, sessionId, directory } = remoteEntryDeleteDialog
    const isDirectory = entry.type === 'directory'
    setRemoteEntryDeleting(true)
    setRemoteEntryDeleteError(null)
    try {
      await window.remoteFiles.deleteRemoteEntry(sessionId, entry.path)
    } catch (error) {
      setRemoteEntryDeleteError(errorMessage(error))
      return
    } finally {
      setRemoteEntryDeleting(false)
    }

    setRemoteEntryDeleteDialog(null)
    updateSession(sessionId, (session) => ({
      ...session,
      entries: session.entries.filter((item) => item.path !== entry.path),
    }))
    const refreshed = await loadDirectory(sessionId, directory)
    if (refreshed) {
      showToast('info', `${isDirectory ? '文件夹' : '文件'}已删除`)
    }
  }

  const handleEntryContextMenu = (event: ReactMouseEvent<HTMLElement>, entry: RemoteEntry) => {
    if (entry.type !== 'file' && entry.type !== 'directory') return
    event.preventDefault()
    openEntryContextMenu(entry, event.clientX, event.clientY)
  }

  const handleBackgroundContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('[data-entry-path], button, a, input, select, textarea, th')) return
    event.preventDefault()
    openDirectoryContextMenu(event.clientX, event.clientY)
  }

  const handleEntryKeyDown = (event: ReactKeyboardEvent<HTMLElement>, entry: RemoteEntry) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    openEntryContextMenu(entry, bounds.left + 12, bounds.top + 12)
  }

  const handleContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const activeItem = document.activeElement as HTMLElement
    if (event.key === 'ArrowRight' && activeItem.getAttribute('aria-haspopup') === 'menu') {
      event.preventDefault()
      activeItem.parentElement?.querySelector<HTMLElement>('.sort-menu-item')?.focus()
      return
    }
    if (event.key === 'ArrowLeft' && activeItem.closest('.sort-submenu-panel')) {
      event.preventDefault()
      activeItem.closest('.context-submenu')?.querySelector<HTMLElement>('.submenu-trigger')?.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'))
      .filter((item) => item.getClientRects().length > 0)
    const index = items.indexOf(activeItem)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
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
    <div className="app-shell" onAuxClick={(event) => {
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
              onClick={() => void openSettingsDialog()}
            >
              <Settings size={16} />
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
              highlightedPath={highlightedPath}
              onViewModeChange={(mode) => patchSession(activeSession.id, { viewMode: mode })}
              onNavigate={navigate}
              onToggleSort={toggleSort}
              onEntryContextMenu={handleEntryContextMenu}
              onEntryKeyDown={handleEntryKeyDown}
              onBackgroundContextMenu={handleBackgroundContextMenu}
              onDropUpload={uploadDroppedEntries}
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
          <FileContextMenu
            menu={browserContextMenu}
            sort={sort}
            elementRef={contextMenuRef}
            onKeyDown={handleContextMenuKeyDown}
            onSelectSortColumn={(column) => patchSession(activeSession.id, { sort: { ...sort, column } })}
            onSelectSortDirection={(direction) => patchSession(activeSession.id, { sort: { ...sort, direction } })}
            onPreview={(entry) => {
              setBrowserContextMenu(null)
              void previewFile(entry)
            }}
            onPreviewLog={(entry) => {
              setBrowserContextMenu(null)
              void previewLogFile(entry)
            }}
            onDownload={(entry) => {
              setBrowserContextMenu(null)
              download(entry)
            }}
            onCopyPath={(entry) => void copyEntryPath(entry)}
            onDelete={requestRemoteEntryDeletion}
            onCopyCurrentPath={() => void copyCurrentPath()}
            onCreateDirectory={() => {
              setBrowserContextMenu(null)
              setCreateDirectoryDialog({ name: '' })
            }}
            onUpload={() => {
              setBrowserContextMenu(null)
              uploadFiles()
            }}
          />
        )}

        <TransferTray
          transfers={transfers}
          onCancel={cancelTransferJob}
          onDismiss={dismissTransfer}
        />
      </main>

      <GlobalToast notice={toast} onDismiss={dismissToast} />

      <DialogLayer
        profileDialog={profileDialog}
        profileDeleteDialog={profileDeleteDialog}
        profileDeleteError={profileDeleteError}
        profileDeleting={profileDeleting}
        createDirectoryDialog={createDirectoryDialog}
        creatingDirectory={creatingDirectory}
        settingsForm={settingsForm}
        profiles={profiles}
        settingsSaving={settingsSaving}
        previewDialog={previewDialog}
        logPreviewDialog={logPreviewDialog}
        pendingHostKey={pendingHostKey}
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
        onUpdateProfile={updateProfileForm}
        onSubmitProfile={(event) => void submitProfile(event)}
        onCloseSettings={closeSettingsDialog}
        onUpdateSettings={updateSettingsForm}
        onUpdateDefaultView={updateDefaultView}
        onUpdateStartupProfile={updateStartupProfile}
        onUpdateStartupKind={updateStartupKind}
        onSubmitSettings={(event) => void submitSettings(event)}
        onClosePreview={closePreview}
        onLogPreviewScroll={onLogPreviewScroll}
        onPreviewImageLoad={onImageLoad}
        onZoomPreviewImage={zoomImage}
        onTrustHostKey={() => void trustAndReconnect()}
        onDismissHostKey={dismissHostKey}
      />

      {remoteEntryDeleteDialog && (
        <ConfirmationDialog
          eyebrow="远程文件操作"
          title={remoteEntryDeleteDialog.entry.type === 'directory' ? '删除远程文件夹？' : '删除远程文件？'}
          details={[
            { label: '名称', value: remoteEntryDeleteDialog.entry.name },
            { label: '远程路径', value: remoteEntryDeleteDialog.entry.path },
          ]}
          description={remoteEntryDeleteDialog.entry.type === 'directory'
            ? '此操作无法撤销，文件夹中的所有内容也会一并删除。'
            : '此操作无法撤销，远程文件将被永久删除。'}
          tone="danger"
          confirmLabel={remoteEntryDeleteDialog.entry.type === 'directory' ? '删除文件夹' : '删除文件'}
          busyLabel="正在删除"
          error={remoteEntryDeleteError}
          errorLabel="删除失败"
          busy={remoteEntryDeleting}
          onConfirm={() => void confirmRemoteEntryDeletion()}
          onCancel={cancelRemoteEntryDeletion}
        />
      )}

      {searchProfile && searchSession && searchSessionId && (
        <SearchDialog
          key={searchSessionId}
          sessionId={searchSessionId}
          profileId={searchSession.profileId}
          currentPath={searchSession.currentPath}
          previewOpen={Boolean(previewDialog || logPreviewDialog)}
          onClose={() => setSearchSessionId(null)}
          onSelectResult={(result) => void locateSearchResult(result)}
          onPreviewResult={(result) => void previewFile(result)}
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
