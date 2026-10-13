import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Cloud, FolderUp, HardDrive, RefreshCw, Settings, Upload, WifiOff } from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import FileBrowser from './components/FileBrowser'
import EntryContextMenu from './components/EntryContextMenu'
import ServerList from './components/ServerList'
import TransferTray from './components/TransferTray'
import DialogLayer from './components/DialogLayer'
import { usePreview } from './hooks/usePreview'
import { useTransfers } from './hooks/useTransfers'
import { useProfileManagement } from './hooks/useProfileManagement'
import type {
  RemoteEntry,
  ServerProfile,
  TrustHostKeyInput,
} from '@shared/types'
import type {
  EntryContextMenu as EntryContextMenuState,
  FileViewMode,
  PendingHostKey,
  RecentConnection,
  SortColumn,
  SortDirection,
} from './app-types'
import {
  connectFailureText,
  entryNameCollator,
  errorMessage,
  readRecentConnections,
  readDefaultView,
} from './app-utils'

export default function App() {
  const [connectedProfileId, setConnectedProfileId] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [connectionPending, setConnectionPending] = useState(false)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [viewMode, setViewMode] = useState<FileViewMode>(readDefaultView)
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'name',
    direction: 'ascending',
  })
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKey | null>(null)
  const [entryContextMenu, setEntryContextMenu] = useState<EntryContextMenuState | null>(null)
  const toastSequenceRef = useRef(0)
  const connectionAttemptRef = useRef(0)
  const connectingProfilesRef = useRef(new Set<string>())
  const directoryLoadRef = useRef(0)
  const pathHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const showToast = useCallback((kind: ToastNotice['kind'], message: string) => {
    setToast({ id: ++toastSequenceRef.current, kind, message })
  }, [])
  const {
    previewDialog,
    imageZoom,
    imagePreviewSize,
    imageViewportRef,
    previewImageRef,
    closePreview,
    previewFile,
    onImageLoad,
    zoomImage,
  } = usePreview({ connectedProfileId, showToast })
  const dismissToast = useCallback(() => setToast(null), [])
  const {
    profiles,
    profileDialog,
    settingsForm,
    settingsLoading,
    settingsSaving,
    openProfileDialog,
    openSettingsDialog,
    updateProfileForm,
    submitProfile,
    removeProfile,
    updateSettingsForm,
    updateDefaultView,
    submitSettings,
    closeProfileDialog,
    closeSettingsDialog,
  } = useProfileManagement({
    showToast,
    clearToast: dismissToast,
    onProfileDeleted: (profileId) => {
      setRecentConnections((current) => current.filter((connection) => connection.profileId !== profileId))
    },
    onDefaultViewChange: setViewMode,
  })
  const resetPathNavigation = useCallback(() => {
    pathHistoryRef.current = []
    historyIndexRef.current = -1
    directoryLoadRef.current += 1
    setEntryContextMenu(null)
    setLoading(false)
  }, [])

  const connectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectedProfileId) ?? null,
    [profiles, connectedProfileId],
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
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      if (event.profileId !== connectedProfileId) return
      resetPathNavigation()
      setConnectedProfileId(null)
      setEntries([])
      showToast('error', `连接已断开：${event.message}`)
    })
    return () => {
      removeClosedListener()
    }
  }, [connectedProfileId, resetPathNavigation, showToast])

  useEffect(() => {
    if (!entryContextMenu) return

    const dismissOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setEntryContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEntryContextMenu(null)
    }
    const dismiss = () => setEntryContextMenu(null)

    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    contextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [entryContextMenu])

  const loadDirectory = async (profileId: string, remotePath: string) => {
    const requestId = ++directoryLoadRef.current
    setLoading(true)
    try {
      const nextEntries = await window.remoteFiles.listDirectory(profileId, remotePath)
      if (requestId !== directoryLoadRef.current) return false
      setEntries(nextEntries)
      setCurrentPath(remotePath)
      setToast(null)
      return true
    } catch (error) {
      if (requestId === directoryLoadRef.current) showToast('error', errorMessage(error))
      return false
    } finally {
      if (requestId === directoryLoadRef.current) setLoading(false)
    }
  }

  const {
    transfers,
    cancelTransfer: cancelTransferJob,
    uploadFiles,
    uploadFolder,
    download,
    dismissTransfer,
  } = useTransfers({ connectedProfileId, currentPath, loadDirectory, showToast })

  const connectTo = async (profile: ServerProfile) => {
    if (connectedProfileId === profile.id || connectingProfilesRef.current.has(profile.id)) return

    resetPathNavigation()
    const attempt = ++connectionAttemptRef.current
    connectingProfilesRef.current.add(profile.id)
    setConnectionPending(true)
    setToast(null)
    setEntries([])
    setConnectedProfileId(null)
    try {
      const result = await window.remoteFiles.connect(profile.id)
      if (attempt !== connectionAttemptRef.current) {
        if (result.ok) await window.remoteFiles.disconnect(profile.id)
        return
      }
      if (!result.ok) {
        if (result.reason === 'host-key-unknown') {
          setPendingHostKey({ profile, fingerprint: result.fingerprint })
        } else if (result.reason === 'host-key-changed') {
          setPendingHostKey({
            profile,
            fingerprint: result.fingerprint,
            previousFingerprint: result.previousFingerprint,
          })
        } else {
          showToast('error', connectFailureText(result))
        }
        return
      }
      setRecentConnections((current) => [
        { profileId: profile.id, connectedAt: Date.now() },
        ...current.filter((connection) => connection.profileId !== profile.id),
      ])
      setConnectedProfileId(profile.id)
      pathHistoryRef.current = [result.path]
      historyIndexRef.current = 0
      await loadDirectory(profile.id, result.path)
    } catch (error) {
      if (attempt === connectionAttemptRef.current) showToast('error', errorMessage(error))
    } finally {
      connectingProfilesRef.current.delete(profile.id)
      if (attempt === connectionAttemptRef.current) setConnectionPending(false)
    }
  }

  const navigate = (remotePath: string) => {
    if (!connectedProfileId) return
    if (remotePath === currentPath) {
      void loadDirectory(connectedProfileId, remotePath)
      return
    }

    const previousHistory = pathHistoryRef.current
    const previousIndex = historyIndexRef.current
    const nextHistory = previousHistory.slice(0, previousIndex + 1)
    if (nextHistory.at(-1) !== remotePath) nextHistory.push(remotePath)
    pathHistoryRef.current = nextHistory
    historyIndexRef.current = nextHistory.length - 1
    const nextIndex = historyIndexRef.current
    void loadDirectory(connectedProfileId, remotePath).then((loaded) => {
      if (!loaded && historyIndexRef.current === nextIndex) {
        pathHistoryRef.current = previousHistory
        historyIndexRef.current = previousIndex
      }
    })
  }

  const movePathHistory = (offset: -1 | 1) => {
    if (!connectedProfileId) return
    const previousIndex = historyIndexRef.current
    const nextIndex = previousIndex + offset
    const remotePath = pathHistoryRef.current[nextIndex]
    if (remotePath === undefined) return

    historyIndexRef.current = nextIndex
    void loadDirectory(connectedProfileId, remotePath).then((loaded) => {
      if (!loaded && historyIndexRef.current === nextIndex) historyIndexRef.current = previousIndex
    })
  }
  const disconnect = async () => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    await window.remoteFiles.disconnect(profileId)
    resetPathNavigation()
    setConnectedProfileId(null)
    setEntries([])
    setToast(null)
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
      const profile = pendingHostKey.profile
      setPendingHostKey(null)
      await connectTo(profile)
    } catch (error) {
      setPendingHostKey(null)
      showToast('error', errorMessage(error))
    }
  }

  const openEntryContextMenu = (entry: RemoteEntry, x: number, y: number) => {
    if (entry.type !== 'file' && entry.type !== 'directory') return
    const menuWidth = 204
    const menuHeight = (entry.type === 'file' ? 4 : 3) * 34 + 14
    setEntryContextMenu({
      entry,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
  }

  const copyAbsolutePath = async (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    setEntryContextMenu(null)
    try {
      await window.remoteFiles.copyRemotePath(connectedProfileId, entry.path)
      showToast('info', '绝对路径已复制')
    } catch (error) {
      showToast('error', `复制路径失败：${errorMessage(error)}`)
    }
  }

  const deleteRemoteEntry = async (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const directory = currentPath
    const isDirectory = entry.type === 'directory'
    const detail = isDirectory ? '及其中所有内容' : ''
    if (!window.confirm(`确定删除“${entry.name}”${detail}？此操作无法撤销。`)) return
    setEntryContextMenu(null)
    try {
      await window.remoteFiles.deleteRemoteEntry(profileId, entry.path)
      setEntries((current) => current.filter((item) => item.path !== entry.path))
      const refreshed = await loadDirectory(profileId, directory)
      setEntries((current) => current.filter((item) => item.path !== entry.path))
      if (refreshed) {
        showToast('info', `${isDirectory ? '文件夹' : '文件'}已删除`)
      }
    } catch (error) {
      showToast('error', `删除失败：${errorMessage(error)}`)
    }
  }

  const handleEntryContextMenu = (event: ReactMouseEvent<HTMLElement>, entry: RemoteEntry) => {
    if (entry.type !== 'file' && entry.type !== 'directory') return
    event.preventDefault()
    openEntryContextMenu(entry, event.clientX, event.clientY)
  }

  const handleEntryKeyDown = (event: ReactKeyboardEvent<HTMLElement>, entry: RemoteEntry) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
    event.preventDefault()
    const bounds = event.currentTarget.getBoundingClientRect()
    openEntryContextMenu(entry, bounds.left + 12, bounds.top + 12)
  }

  const handleContextMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
    const index = items.indexOf(document.activeElement as HTMLElement)
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
    setSort((current) => current.column === column
      ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
      : { column, direction: 'ascending' })
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
            <div className="topbar-brand">
              <div className="brand-mark"><HardDrive size={18} strokeWidth={2.1} /></div>
              <div className="brand-name">Linux Nexus</div>
            </div>
            <span className="topbar-separator" />
            <div className="page-title">{connectedProfile ? '文件' : '服务器'}</div>
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
          </div>
          <div className="topbar-actions">
            {connectedProfileId ? (
              <>
                <button className="text-button upload-button" title="上传文件到当前目录" aria-label="上传文件到当前目录" onClick={uploadFiles}>
                  <Upload size={15} /> 上传文件
                </button>
                <button className="text-button upload-button" title="上传文件夹到当前目录" aria-label="上传文件夹到当前目录" onClick={uploadFolder}>
                  <FolderUp size={15} /> 上传文件夹
                </button>
                <button className="icon-button toolbar-button" title="刷新目录" aria-label="刷新目录" disabled={loading} onClick={() => void loadDirectory(connectedProfileId, currentPath)}>
                  <RefreshCw className={loading ? 'spin' : ''} size={17} />
                </button>
                <button className="text-button disconnect-button" onClick={() => void disconnect()}><WifiOff size={15} /> 断开</button>
              </>
            ) : (
              <span className="connection-pill"><WifiOff size={14} /> 未连接</span>
            )}
          </div>
        </header>

        {connectedProfile ? (
          <FileBrowser
            currentPath={currentPath}
            entries={entries}
            loading={loading}
            viewMode={viewMode}
            breadcrumbs={breadcrumbs}
            sort={sort}
            sortedEntries={sortedEntries}
            onViewModeChange={setViewMode}
            onNavigate={navigate}
            onToggleSort={toggleSort}
            onEntryContextMenu={handleEntryContextMenu}
            onEntryKeyDown={handleEntryKeyDown}
          />
        ) : (
          <ServerList
            profiles={offlineProfiles}
            connectionPending={connectionPending}
            onAdd={() => openProfileDialog('create')}
            onConnect={(profile) => void connectTo(profile)}
            onEdit={(profile) => openProfileDialog('edit', profile)}
            onDelete={(profile) => void removeProfile(profile)}
          />
        )}

        {entryContextMenu && (
          <EntryContextMenu
            menu={entryContextMenu}
            elementRef={contextMenuRef}
            onKeyDown={handleContextMenuKeyDown}
            onPreview={(entry) => {
              setEntryContextMenu(null)
              void previewFile(entry)
            }}
            onDownload={(entry) => {
              setEntryContextMenu(null)
              download(entry)
            }}
            onCopyPath={(entry) => void copyAbsolutePath(entry)}
            onDelete={(entry) => void deleteRemoteEntry(entry)}
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
        settingsForm={settingsForm}
        settingsSaving={settingsSaving}
        previewDialog={previewDialog}
        pendingHostKey={pendingHostKey}
        imageZoom={imageZoom}
        imagePreviewSize={imagePreviewSize}
        imageViewportRef={imageViewportRef}
        previewImageRef={previewImageRef}
        onCloseProfile={closeProfileDialog}
        onUpdateProfile={updateProfileForm}
        onSubmitProfile={(event) => void submitProfile(event)}
        onCloseSettings={closeSettingsDialog}
        onUpdateSettings={updateSettingsForm}
        onUpdateDefaultView={updateDefaultView}
        onSubmitSettings={(event) => void submitSettings(event)}
        onClosePreview={closePreview}
        onPreviewImageLoad={onImageLoad}
        onZoomPreviewImage={zoomImage}
        onTrustHostKey={() => void trustAndReconnect()}
        onDismissHostKey={() => setPendingHostKey(null)}
      />

    </div>
  )
}
