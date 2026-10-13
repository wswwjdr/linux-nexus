import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Cloud, FolderUp, RefreshCw, Search, Settings, Upload, WifiOff } from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import FileBrowser from './components/FileBrowser'
import FileContextMenu from './components/FileContextMenu'
import ServerList from './components/ServerList'
import TransferTray from './components/TransferTray'
import SearchDialog from './components/SearchDialog'
import DialogLayer from './components/DialogLayer'
import { usePreview } from './hooks/usePreview'
import { useTransfers } from './hooks/useTransfers'
import { useProfileManagement } from './hooks/useProfileManagement'
import type {
  RemoteEntry,
  RemoteSearchResult,
  ServerProfile,
  TrustHostKeyInput,
} from '@shared/types'
import type {
  BrowserContextMenu as BrowserContextMenuState,
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
  getParentPath,
} from './app-utils'

const entryTypeLabels: Record<RemoteEntry['type'], string> = {
  directory: '文件夹',
  file: '文件',
  symlink: '符号链接',
  other: '其他',
}

function getEntryTypeExtension(name: string): string {
  const extensionStart = name.lastIndexOf('.')
  return extensionStart > 0 && extensionStart < name.length - 1
    ? name.slice(extensionStart + 1).toLocaleLowerCase('zh-CN')
    : ''
}

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
  const [browserContextMenu, setBrowserContextMenu] = useState<BrowserContextMenuState | null>(null)
  const [createDirectoryDialog, setCreateDirectoryDialog] = useState<{ name: string } | null>(null)
  const [creatingDirectory, setCreatingDirectory] = useState(false)
  const [searchProfileId, setSearchProfileId] = useState<string | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null)
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
    setBrowserContextMenu(null)
    setCreateDirectoryDialog(null)
    setLoading(false)
  }, [])

  const connectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectedProfileId) ?? null,
    [profiles, connectedProfileId],
  )
  const searchProfile = useMemo(
    () => profiles.find((profile) => profile.id === searchProfileId) ?? null,
    [profiles, searchProfileId],
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
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f' || !connectedProfileId) return
      event.preventDefault()
      if (!searchProfileId) setSearchProfileId(connectedProfileId)
    }
    window.addEventListener('keydown', openSearchShortcut)
    return () => window.removeEventListener('keydown', openSearchShortcut)
  }, [connectedProfileId, searchProfileId])

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

  const loadDirectory = async (profileId: string, remotePath: string) => {
    const requestId = ++directoryLoadRef.current
    setHighlightedPath(null)
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

  const navigate = (remotePath: string): Promise<boolean> => {
    if (!connectedProfileId) return Promise.resolve(false)
    if (remotePath === currentPath) {
      return loadDirectory(connectedProfileId, remotePath)
    }

    const previousHistory = pathHistoryRef.current
    const previousIndex = historyIndexRef.current
    const nextHistory = previousHistory.slice(0, previousIndex + 1)
    if (nextHistory.at(-1) !== remotePath) nextHistory.push(remotePath)
    pathHistoryRef.current = nextHistory
    historyIndexRef.current = nextHistory.length - 1
    const nextIndex = historyIndexRef.current
    return loadDirectory(connectedProfileId, remotePath).then((loaded) => {
      if (!loaded && historyIndexRef.current === nextIndex) {
        pathHistoryRef.current = previousHistory
        historyIndexRef.current = previousIndex
      }
      return loaded
    })
  }

  const locateSearchResult = async (result: RemoteSearchResult) => {
    const profileId = searchProfileId
    setSearchProfileId(null)
    if (!profileId || profileId !== connectedProfileId) return
    const loaded = await navigate(getParentPath(result.path))
    if (loaded) setHighlightedPath(result.path)
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

  const openBrowserContextMenu = (menu: BrowserContextMenuState) => {
    const itemCount = menu.kind === 'directory' ? 4 : menu.entry.type === 'file' ? 4 : 3
    const menuWidth = 204
    const menuHeight = itemCount * 34 + 14
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
    if (!connectedProfileId) return
    setBrowserContextMenu(null)
    try {
      await window.remoteFiles.copyRemotePath(connectedProfileId, remotePath)
      showToast('info', '路径已复制')
    } catch (error) {
      showToast('error', `复制路径失败：${errorMessage(error)}`)
    }
  }

  const copyEntryPath = (entry: RemoteEntry) => copyPath(entry.path)
  const copyCurrentPath = () => copyPath(currentPath)

  const submitCreateDirectory = async (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!connectedProfileId || !createDirectoryDialog) return
    const profileId = connectedProfileId
    const directory = currentPath
    const { name } = createDirectoryDialog
    setCreatingDirectory(true)
    try {
      await window.remoteFiles.createRemoteDirectory(profileId, directory, name)
      setCreateDirectoryDialog(null)
      if (await loadDirectory(profileId, directory)) {
        showToast('info', '文件夹已创建')
      }
    } catch (error) {
      showToast('error', `创建失败：${errorMessage(error)}`)
    } finally {
      setCreatingDirectory(false)
    }
  }

  const deleteRemoteEntry = async (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const directory = currentPath
    const isDirectory = entry.type === 'directory'
    const detail = isDirectory ? '及其中所有内容' : ''
    if (!window.confirm(`确定删除“${entry.name}”${detail}？此操作无法撤销。`)) return
    setBrowserContextMenu(null)
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
    setSort((current) => current.column === column
      ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
      : { column, direction: 'ascending' })
  }

  const openSearch = () => {
    if (connectedProfileId) setSearchProfileId(connectedProfileId)
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
                <button className="icon-button toolbar-button" title="搜索文件（Ctrl+F）" aria-label="搜索文件（Ctrl+F）" onClick={openSearch}>
                  <Search size={16} />
                </button>
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
            highlightedPath={highlightedPath}
            onViewModeChange={setViewMode}
            onNavigate={navigate}
            onToggleSort={toggleSort}
            onEntryContextMenu={handleEntryContextMenu}
            onEntryKeyDown={handleEntryKeyDown}
            onBackgroundContextMenu={handleBackgroundContextMenu}
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

        {browserContextMenu && (
          <FileContextMenu
            menu={browserContextMenu}
            sort={sort}
            elementRef={contextMenuRef}
            onKeyDown={handleContextMenuKeyDown}
            onSelectSortColumn={(column) => setSort((current) => ({ ...current, column }))}
            onSelectSortDirection={(direction) => setSort((current) => ({ ...current, direction }))}
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
            onDelete={(entry) => void deleteRemoteEntry(entry)}
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
        createDirectoryDialog={createDirectoryDialog}
        creatingDirectory={creatingDirectory}
        settingsForm={settingsForm}
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
        onSubmitSettings={(event) => void submitSettings(event)}
        onClosePreview={closePreview}
        onLogPreviewScroll={onLogPreviewScroll}
        onPreviewImageLoad={onImageLoad}
        onZoomPreviewImage={zoomImage}
        onTrustHostKey={() => void trustAndReconnect()}
        onDismissHostKey={() => setPendingHostKey(null)}
      />

      {searchProfile && searchProfileId && (
        <SearchDialog
          key={searchProfileId}
          profileId={searchProfileId}
          currentPath={currentPath}
          onClose={() => setSearchProfileId(null)}
          onSelectResult={(result) => void locateSearchResult(result)}
        />
      )}

    </div>
  )
}
