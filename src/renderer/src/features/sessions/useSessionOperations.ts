import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ServerProfile, SessionKind, StartupConnection, TrustHostKeyInput } from '@shared/types'
import type { PendingHostKey, RecentConnection, SessionTab, BrowserContextMenu } from '@/app-types'
import type { SessionPreviewActions } from '@/features/files/SftpSessionWorkspace'
import type { ToastNotice } from '@/GlobalToast'
import { connectFailureText, errorMessage, getParentPath } from '@/app-utils'

interface SessionContextMenuState {
  sessionId: string
  x: number
  y: number
}

interface UseSessionOperationsOptions {
  sessions: SessionTab[]
  sessionsRef: MutableRefObject<SessionTab[]>
  profiles: ServerProfile[]
  activeSessionId: string | null
  activeSession: SessionTab | null
  viewModeDefault: SessionTab['viewMode']
  pendingHostKey: PendingHostKey | null
  startupConnection: StartupConnection | null
  profileDataLoaded: boolean
  setSessions: Dispatch<SetStateAction<SessionTab[]>>
  setActiveSessionId: Dispatch<SetStateAction<string | null>>
  setPendingHostKeys: Dispatch<SetStateAction<PendingHostKey[]>>
  setRecentConnections: Dispatch<SetStateAction<RecentConnection[]>>
  setBrowserContextMenu: Dispatch<SetStateAction<BrowserContextMenu | null>>
  setSessionContextMenu: Dispatch<SetStateAction<SessionContextMenuState | null>>
  setSessionChooserOpen: Dispatch<SetStateAction<boolean>>
  setCreateDirectoryDialog: Dispatch<SetStateAction<{ name: string } | null>>
  patchSession: (sessionId: string, patch: Partial<SessionTab>) => void
  updateSession: (sessionId: string, update: (session: SessionTab) => SessionTab) => void
  loadDirectory: (sessionId: string, remotePath: string) => Promise<boolean>
  removeSessionWorkspaceState: (sessionIds: string[]) => void
  removeSessionScriptStates: (sessionIds: string[]) => void
  removeSessionPerformanceState: (sessionIds: string[]) => void
  previewActionsRef: MutableRefObject<Map<string, SessionPreviewActions>>
  directoryLoadIdsRef: MutableRefObject<Map<string, number>>
  connectingSessionsRef: MutableRefObject<Set<string>>
  setSearchOpen: (sessionId: string, open: boolean) => void
  showToast: (kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => void
}

export function useSessionOperations({
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
  removeSessionScriptStates,
  removeSessionPerformanceState,
  previewActionsRef,
  directoryLoadIdsRef,
  connectingSessionsRef,
  setSearchOpen,
  showToast,
}: UseSessionOperationsOptions) {
  const startupConnectionAttemptedRef = useRef(false)

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
    setActiveSessionId(id)
    const nextSessions = [...sessionsRef.current, session]
    sessionsRef.current = nextSessions
    setSessions(nextSessions)
    setSessionChooserOpen(false)
    void connectSession(session, profile)
  }

  const createChosenSession = (profileId: string, kind: SessionKind) => {
    const profile = profiles.find((candidate) => candidate.id === profileId)
    if (profile) openSession(profile, kind)
  }

  const duplicateSession = (sessionId: string) => {
    const source = sessionsRef.current.find((session) => session.id === sessionId)
    const profile = profiles.find((candidate) => candidate.id === source?.profileId)
    if (source && profile) openSession(profile, source.kind, source.startPath, source)
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
    removeSessionWorkspaceState([sessionId])
    removeSessionScriptStates([sessionId])
    removeSessionPerformanceState([sessionId])
    previewActionsRef.current.delete(sessionId)
    if (activeSessionId === sessionId) {
      const next = remaining[previousIndex] ?? remaining[previousIndex - 1]
      setActiveSessionId(next?.id ?? null)
    }
    setBrowserContextMenu(null)
    setSessionContextMenu(null)
    void window.remoteFiles.disconnect(sessionId).catch((error) => showToast('error', errorMessage(error)))
  }

  const activateSession = (sessionId: string) => {
    if (activeSessionId === sessionId) return
    setBrowserContextMenu(null)
    setCreateDirectoryDialog(null)
    setActiveSessionId(sessionId)
  }

  const goHome = () => {
    setBrowserContextMenu(null)
    setCreateDirectoryDialog(null)
    setActiveSessionId(null)
  }

  const navigateSession = (sessionId: string, remotePath: string): Promise<boolean> => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (session?.kind !== 'sftp' || session.status !== 'connected') return Promise.resolve(false)
    const nextHistory = session.history.slice(0, session.historyIndex + 1)
    if (nextHistory.at(-1) !== remotePath) nextHistory.push(remotePath)
    updateSession(sessionId, (current) => ({ ...current, history: nextHistory, historyIndex: nextHistory.length - 1 }))
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

  const locateSearchResult = async (result: { path: string }, sessionId: string) => {
    setSearchOpen(sessionId, false)
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

  return {
    startupConnectionAttempted: startupConnectionAttemptedRef.current,
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
  }
}
