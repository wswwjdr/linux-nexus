import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronRight,
  Cloud,
  Eye,
  File,
  Folder,
  FolderUp,
  HardDrive,
  History,
  House,
  KeyRound,
  LayoutGrid,
  List,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react'
import GlobalToast, { type ToastNotice } from './GlobalToast'
import type {
  ConnectResult,
  PreviewLimits,
  PreviewResult,
  RemoteEntry,
  SaveProfileInput,
  ServerProfile,
  TransferProgress,
  TrustHostKeyInput,
} from '@shared/types'

interface ProfileForm {
  id: string
  name: string
  host: string
  port: string
  username: string
  password: string
}

interface PendingHostKey {
  profile: ServerProfile
  fingerprint: string
  previousFingerprint?: string
}

interface TransferJob {
  name: string
  direction: 'upload' | 'download'
  transferred: number
  total: number
  finished: boolean
}

interface RecentConnection {
  profileId: string
  connectedAt: number
}

interface EntryContextMenu {
  entry: RemoteEntry
  x: number
  y: number
}

type PreviewDialog =
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; result: PreviewResult }

type FileViewMode = 'icons' | 'details'
type SortColumn = 'name' | 'type' | 'size' | 'modifiedAt' | 'permissions'
type SortDirection = 'ascending' | 'descending'
type PreviewLimitKey = keyof PreviewLimits
type PreviewLimitsForm = Record<PreviewLimitKey, string>

const previewLimitFields: { key: PreviewLimitKey; label: string }[] = [
  { key: 'textMiB', label: '文本文件上限（MiB）' },
  { key: 'imageMiB', label: '图片文件上限（MiB）' },
  { key: 'audioMiB', label: '音频文件上限（MiB）' },
  { key: 'videoMiB', label: '视频文件上限（MiB）' },
]

const entryNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })
const entryTypeOrder: Record<RemoteEntry['type'], number> = {
  directory: 0,
  file: 1,
  symlink: 2,
  other: 3,
}

const emptyForm = (): ProfileForm => ({
  id: '',
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
})

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function getEntryTypeLabel(entry: RemoteEntry): string {
  if (entry.type === 'directory') return '文件夹'
  if (entry.type === 'symlink') return '链接'
  if (entry.type === 'file') return '文件'
  return '其他'
}

function readViewMode(): FileViewMode {
  const savedMode = window.localStorage.getItem('remote-files:view-mode')
  return savedMode === 'icons' || savedMode === 'details' ? savedMode : 'details'
}

function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem('remote-files:sidebar-collapsed') === 'true'
}

function readRecentConnections(): RecentConnection[] {
  const savedConnections = window.localStorage.getItem('remote-files:recent-connections')
  return savedConnections ? JSON.parse(savedConnections) as RecentConnection[] : []
}

function getParentPath(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试'
}

function connectFailureText(result: Exclude<ConnectResult, { ok: true }>): string {
  if (result.reason === 'auth-failed') return result.message
  if (result.reason === 'unreachable') return result.message
  if (result.reason === 'sftp-unavailable') return `服务器未提供 SFTP：${result.message}`
  if (result.reason === 'other') return result.message
  return ''
}

export default function App() {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null)
  const [connectedProfileId, setConnectedProfileId] = useState<string | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [connectionPending, setConnectionPending] = useState(false)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [viewMode, setViewMode] = useState<FileViewMode>(readViewMode)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [recentConnections, setRecentConnections] = useState<RecentConnection[]>(readRecentConnections)
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({
    column: 'name',
    direction: 'ascending',
  })
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; form: ProfileForm } | null>(null)
  const [settingsForm, setSettingsForm] = useState<PreviewLimitsForm | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKey | null>(null)
  const [transfers, setTransfers] = useState<Record<string, TransferJob>>({})
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null)
  const [entryContextMenu, setEntryContextMenu] = useState<EntryContextMenu | null>(null)
  const toastSequenceRef = useRef(0)
  const connectionAttemptRef = useRef(0)
  const connectingProfilesRef = useRef(new Set<string>())
  const previewTokenRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const directoryLoadRef = useRef(0)
  const pathHistoryRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const showToast = useCallback((kind: ToastNotice['kind'], message: string) => {
    setToast({ id: ++toastSequenceRef.current, kind, message })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])
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
  const recentProfiles = useMemo(
    () => recentConnections
      .flatMap((connection) => {
        const profile = profiles.find((candidate) => candidate.id === connection.profileId)
        return profile ? [{ profile, connectedAt: connection.connectedAt }] : []
      })
      .sort((left, right) => right.connectedAt - left.connectedAt),
    [profiles, recentConnections],
  )

  const refreshProfiles = async () => {
    setProfiles(await window.remoteFiles.listProfiles())
  }

  useEffect(() => {
    window.localStorage.setItem('remote-files:view-mode', viewMode)
  }, [viewMode])

  useEffect(() => {
    window.localStorage.setItem('remote-files:sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem('remote-files:recent-connections', JSON.stringify(recentConnections))
  }, [recentConnections])

  useEffect(() => {
    void window.remoteFiles.listProfiles().then(setProfiles).catch((error) => showToast('error', errorMessage(error)))
  }, [showToast])

  useEffect(() => {
    const removeProgressListener = window.remoteFiles.onTransferProgress((progress: TransferProgress) => {
      setTransfers((current) => ({
        ...current,
        [progress.requestId]: {
          name: current[progress.requestId]?.name ?? progress.remotePath.split('/').pop() ?? '文件',
          direction: progress.direction,
          transferred: progress.transferred,
          total: progress.total,
          finished: false,
        },
      }))
    })
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      if (event.profileId !== connectedProfileId) return
      resetPathNavigation()
      setConnectedProfileId(null)
      setEntries([])
      showToast('error', `连接已断开：${event.message}`)
    })
    return () => {
      removeProgressListener()
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

  useEffect(() => () => {
    if (previewTokenRef.current) void window.remoteFiles.releasePreview(previewTokenRef.current)
  }, [])

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

  const connectTo = async (profile: ServerProfile) => {
    if (connectedProfileId === profile.id || connectingProfilesRef.current.has(profile.id)) return

    resetPathNavigation()
    const attempt = ++connectionAttemptRef.current
    connectingProfilesRef.current.add(profile.id)
    setSelectedProfileId(profile.id)
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
  const openProfileDialog = (mode: 'create' | 'edit', profile?: ServerProfile) => {
    setToast(null)
    setDialog({
      mode,
      form: profile
        ? {
            id: profile.id,
            name: profile.name,
            host: profile.host,
            port: String(profile.port),
            username: profile.username,
            password: '',
          }
        : emptyForm(),
    })
  }

  const openSettingsDialog = async () => {
    if (settingsLoading || settingsSaving) return
    setSettingsLoading(true)
    try {
      const limits = await window.remoteFiles.getPreviewLimits()
      setSettingsForm({
        textMiB: String(limits.textMiB),
        imageMiB: String(limits.imageMiB),
        audioMiB: String(limits.audioMiB),
        videoMiB: String(limits.videoMiB),
      })
    } catch (error) {
      showToast('error', `读取设置失败：${errorMessage(error)}`)
    } finally {
      setSettingsLoading(false)
    }
  }

  const updateSettingsForm = (key: PreviewLimitKey, value: string) => {
    setSettingsForm((current) => current ? { ...current, [key]: value } : current)
  }

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsForm) return
    const limits = Object.fromEntries(
      previewLimitFields.map(({ key }) => [key, Number(settingsForm[key])]),
    ) as PreviewLimits
    if (previewLimitFields.some(({ key }) => !Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > 1024)) {
      showToast('error', '预览上限必须是 1 到 1024 之间的整数')
      return
    }

    setSettingsSaving(true)
    try {
      await window.remoteFiles.savePreviewLimits(limits)
      setSettingsForm(null)
      setToast(null)
    } catch (error) {
      showToast('error', `保存设置失败：${errorMessage(error)}`)
    } finally {
      setSettingsSaving(false)
    }
  }

  const updateProfileForm = (patch: Partial<ProfileForm>) => {
    setDialog((current) =>
      current ? { ...current, form: { ...current.form, ...patch } } : current,
    )
  }

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialog) return
    const input: SaveProfileInput = {
      profile: {
        id: dialog.form.id,
        name: dialog.form.name,
        host: dialog.form.host,
        port: Number(dialog.form.port),
        username: dialog.form.username,
      },
      password: dialog.form.password || undefined,
    }
    try {
      const savedProfile = await window.remoteFiles.saveProfile(input)
      await refreshProfiles()
      if (connectedProfileId === savedProfile.id) {
        resetPathNavigation()
        setConnectedProfileId(null)
        setEntries([])
      }
      setSelectedProfileId(savedProfile.id)
      setDialog(null)
      setToast(null)
    } catch (error) {
      showToast('error', errorMessage(error))
    }
  }

  const removeProfile = async (profile: ServerProfile) => {
    if (!window.confirm(`删除“${profile.name}”的连接配置？`)) return
    try {
      await window.remoteFiles.deleteProfile(profile.id)
      setRecentConnections((current) => current.filter((connection) => connection.profileId !== profile.id))
      if (connectedProfileId === profile.id) {
        resetPathNavigation()
        setConnectedProfileId(null)
        setEntries([])
      }
      if (selectedProfileId === profile.id) setSelectedProfileId(null)
      await refreshProfiles()
    } catch (error) {
      showToast('error', errorMessage(error))
    }
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

  const runTransfer = async (
    name: string,
    direction: TransferJob['direction'],
    operation: (requestId: string) => Promise<boolean>,
    refreshPath?: string,
    initialTotal = 0,
  ) => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const requestId = crypto.randomUUID()
    setTransfers((current) => ({
      ...current,
      [requestId]: { name, direction, transferred: 0, total: initialTotal, finished: false },
    }))
    try {
      const transferred = await operation(requestId)
      if (!transferred) {
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
        return
      }
      setTransfers((current) => ({
        ...current,
        [requestId]: {
          ...current[requestId],
          transferred: current[requestId]?.total ?? initialTotal,
          finished: true,
        },
      }))
      window.setTimeout(() => {
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      }, 2800)
      if (refreshPath !== undefined) await loadDirectory(profileId, refreshPath)
    } catch (error) {
      setTransfers((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      showToast('error', `${direction === 'upload' ? '上传' : '下载'}失败：${errorMessage(error)}`)
    }
  }

  const uploadFiles = () => {
    if (!connectedProfileId) return
    const remoteDirectory = currentPath
    void runTransfer('上传文件', 'upload', (requestId) =>
      window.remoteFiles.uploadFiles(requestId, connectedProfileId, remoteDirectory), remoteDirectory)
  }

  const uploadFolder = () => {
    if (!connectedProfileId) return
    const remoteDirectory = currentPath
    void runTransfer('上传文件夹', 'upload', (requestId) =>
      window.remoteFiles.uploadFolder(requestId, connectedProfileId, remoteDirectory), remoteDirectory)
  }

  const download = (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    void runTransfer(entry.name, 'download', (requestId) =>
      window.remoteFiles.downloadEntry(requestId, connectedProfileId!, entry.path), undefined,
    entry.type === 'file' ? entry.size : 0)
  }

  const closePreview = () => {
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    setPreviewDialog(null)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }

  const previewFile = async (entry: RemoteEntry) => {
    closePreview()
    const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.txt', '.sh', '.mp3', '.mp4'])
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (!supportedExtensions.has(extension)) {
      showToast('info', `暂不支持的文件类型：${entry.name}`)
      return
    }
    if (!connectedProfileId) return

    const requestId = previewRequestRef.current
    setPreviewDialog({ kind: 'loading', name: entry.name })
    try {
      const result = await window.remoteFiles.previewFile(connectedProfileId, entry.path)
      if (requestId !== previewRequestRef.current) {
        if (result.type !== 'text') void window.remoteFiles.releasePreview(result.token)
        return
      }
      if (result.type !== 'text') previewTokenRef.current = result.token
      setPreviewDialog({ kind: 'ready', result })
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        setPreviewDialog(null)
        showToast('error', `预览失败：${errorMessage(error)}`)
      }
    }
  }

  const openEntryContextMenu = (entry: RemoteEntry, x: number, y: number) => {
    if (entry.type !== 'file' && entry.type !== 'directory') return
    const menuWidth = 190
    const menuHeight = entry.type === 'file' ? 82 : 46
    setEntryContextMenu({
      entry,
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    })
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
    } else if (sort.column === 'type') {
      comparison = entryTypeOrder[left.type] - entryTypeOrder[right.type]
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

  const sortHeader = (column: SortColumn, label: string) => {
    const active = sort.column === column
    const directionLabel = sort.direction === 'ascending' ? '升序' : '降序'
    return (
      <button
        className={`sort-header ${active ? 'active' : ''}`}
        title={`按${label}排序${active ? `，当前${directionLabel}` : ''}`}
        aria-label={`按${label}排序${active ? `，当前${directionLabel}` : ''}`}
        onClick={() => toggleSort(column)}
      >
        <span>{label}</span>
        {active
          ? sort.direction === 'ascending' ? <ArrowUp size={13} /> : <ArrowDown size={13} />
          : <ArrowUpDown size={13} />}
      </button>
    )
  }

  const transferJobs = Object.entries(transfers)

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`} onAuxClick={(event) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      movePathHistory(event.button === 3 ? -1 : 1)
    }}>
      <aside id="app-sidebar" className="sidebar" aria-hidden={sidebarCollapsed} inert={sidebarCollapsed}>
        <div className="brand-row">
          <div className="brand-mark"><HardDrive size={18} strokeWidth={2.1} /></div>
          <div className="brand-name">远程文件</div>
        </div>

        <div className="sidebar-section">
          <div className="section-heading">
            <span>服务器</span>
            <button className="icon-button add-button" title="添加服务器" aria-label="添加服务器" onClick={() => openProfileDialog('create')}>
              <Plus size={17} />
            </button>
          </div>
          <div className="server-list">
            {profiles.map((profile) => {
              const isSelected = selectedProfileId === profile.id
              const isConnected = connectedProfileId === profile.id
              return (
                <div className={`server-item ${isSelected ? 'selected' : ''}`} key={profile.id}>
                  <button className="server-select" onClick={() => void connectTo(profile)}>
                    <span className={`server-icon ${isConnected ? 'connected' : ''}`}>
                      <Server size={16} />
                    </span>
                    <span className="server-copy">
                      <span className="server-name">{profile.name}</span>
                      <span className="server-address">{profile.username}@{profile.host}</span>
                    </span>
                    {isConnected && <span className="connected-dot" title="已连接" />}
                  </button>
                  <div className="server-actions">
                    <button className="icon-button subtle" title="编辑连接" aria-label={`编辑 ${profile.name}`} onClick={() => openProfileDialog('edit', profile)}>
                      <Pencil size={14} />
                    </button>
                    <button className="icon-button subtle danger-hover" title="删除连接" aria-label={`删除 ${profile.name}`} onClick={() => void removeProfile(profile)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })}
            {profiles.length === 0 && (
              <div className="empty-servers">
                <Server size={19} />
                <span>还没有服务器</span>
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="connection-status">
            <span className={`status-light ${connectedProfileId ? 'online' : ''}`} />
            <span>{connectedProfile ? `已连接到 ${connectedProfile.name}` : '未连接'}</span>
          </div>
          <div className="security-note"><ShieldCheck size={14} /> 密码由 Windows 加密保存</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button toolbar-button"
              title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              aria-expanded={!sidebarCollapsed}
              aria-controls="app-sidebar"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <div className="page-title">文件</div>
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
          <>
            <div className="pathbar">
              <button className="icon-button path-nav" title="返回根目录" aria-label="返回根目录" disabled={currentPath === '/'} onClick={() => navigate('/')}>
                <House size={16} />
              </button>
              <button className="icon-button path-nav nav-group-end" title="返回上级目录" aria-label="返回上级目录" disabled={currentPath === '/'} onClick={() => navigate(getParentPath(currentPath))}>
                <ArrowUp size={16} />
              </button>
              <nav className="breadcrumbs" aria-label="当前路径">
                {breadcrumbs.map((crumb, index) => (
                  <span className="breadcrumb-piece" key={crumb.path}>
                    {index > 0 && <ChevronRight size={13} />}
                    <button className={index === breadcrumbs.length - 1 ? 'current-crumb' : ''} onClick={() => navigate(crumb.path)}>{crumb.label}</button>
                  </span>
                ))}
              </nav>
              <div className="pathbar-tools">
                <div className="view-toggle" role="group" aria-label="文件视图">
                  <button
                    className="view-toggle-button"
                    title="图标视图"
                    aria-label="图标视图"
                    aria-pressed={viewMode === 'icons'}
                    onClick={() => setViewMode('icons')}
                  >
                    <LayoutGrid size={16} />
                  </button>
                  <button
                    className="view-toggle-button"
                    title="详细信息视图"
                    aria-label="详细信息视图"
                    aria-pressed={viewMode === 'details'}
                    onClick={() => setViewMode('details')}
                  >
                    <List size={17} />
                  </button>
                </div>
                <div className="path-count">{entries.length} 项</div>
              </div>
            </div>

            <div className="file-content-wrap">
              {viewMode === 'details' ? (
                <table className="file-table">
                  <thead>
                    <tr>
                      <th className="name-col" aria-sort={sort.column === 'name' ? sort.direction : 'none'}>{sortHeader('name', '名称')}</th>
                      <th className="type-col" aria-sort={sort.column === 'type' ? sort.direction : 'none'}>{sortHeader('type', '类型')}</th>
                      <th className="size-col" aria-sort={sort.column === 'size' ? sort.direction : 'none'}>{sortHeader('size', '大小')}</th>
                      <th className="date-col" aria-sort={sort.column === 'modifiedAt' ? sort.direction : 'none'}>{sortHeader('modifiedAt', '修改时间')}</th>
                      <th className="permission-col" aria-sort={sort.column === 'permissions' ? sort.direction : 'none'}>{sortHeader('permissions', '权限')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => (
                      <tr
                        className="file-row"
                        key={entry.path}
                        tabIndex={entry.type === 'file' ? 0 : -1}
                        onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                        onKeyDown={(event) => handleEntryKeyDown(event, entry)}
                      >
                        <td className="name-col">
                          <button className={`entry-name ${entry.type === 'directory' ? 'directory-entry' : ''}`} onClick={() => entry.type === 'directory' && navigate(entry.path)} disabled={entry.type !== 'directory'}>
                            <span className={`entry-icon ${entry.type === 'directory' ? 'folder-icon' : ''}`}>
                              {entry.type === 'directory' ? <Folder size={17} fill="currentColor" strokeWidth={1.8} /> : <File size={16} />}
                            </span>
                            <span className="entry-label">{entry.name}</span>
                          </button>
                        </td>
                        <td className="type-col">{getEntryTypeLabel(entry)}</td>
                        <td className="size-col">{entry.type === 'directory' ? '—' : formatSize(entry.size)}</td>
                        <td className="date-col">{formatDate(entry.modifiedAt)}</td>
                        <td className="permission-col"><code>{entry.permissions}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="file-icon-grid">
                  {sortedEntries.map((entry) => (
                    <article
                      className="file-tile"
                      key={entry.path}
                      tabIndex={entry.type === 'file' ? 0 : -1}
                      onContextMenu={(event) => handleEntryContextMenu(event, entry)}
                      onKeyDown={(event) => handleEntryKeyDown(event, entry)}
                    >
                      <button
                        className={`file-tile-main ${entry.type === 'directory' ? 'directory-entry' : ''}`}
                        title={entry.name}
                        onClick={() => entry.type === 'directory' && navigate(entry.path)}
                        disabled={entry.type !== 'directory'}
                      >
                        <span className={`tile-glyph ${entry.type === 'directory' ? 'folder-glyph' : ''}`}>
                          {entry.type === 'directory'
                            ? <Folder size={31} fill="currentColor" strokeWidth={1.7} />
                            : <File size={29} />}
                        </span>
                        <span className="tile-name">{entry.name}</span>
                      </button>
                    </article>
                  ))}
                </div>
              )}
              {loading && (
                <div className="table-state"><LoaderCircle className="spin" size={19} /> 正在读取目录</div>
              )}
              {!loading && entries.length === 0 && (
                <div className="table-state empty-directory"><Folder size={22} /> 此目录为空</div>
              )}
            </div>
          </>
        ) : (
          <div className={`welcome-state ${recentProfiles.length ? 'welcome-history' : ''}`}>
            {recentProfiles.length ? (
              <section className="recent-connections" aria-labelledby="recent-connections-title">
                <div className="recent-heading">
                  <div className="recent-heading-icon"><History size={18} /></div>
                  <h1 id="recent-connections-title">最近连接</h1>
                </div>
                <div className="recent-list">
                  {recentProfiles.map(({ profile, connectedAt }) => (
                    <button
                      className="recent-connection"
                      key={profile.id}
                      disabled={connectionPending}
                      onClick={() => void connectTo(profile)}
                    >
                      <span className="recent-server-icon"><Server size={17} /></span>
                      <span className="recent-server-copy">
                        <span className="recent-server-name">{profile.name}</span>
                        <span className="recent-server-address">{profile.username}@{profile.host}:{profile.port}</span>
                      </span>
                      <span className="recent-connected-at">{formatDate(new Date(connectedAt).toISOString())}</span>
                      <ChevronRight className="recent-chevron" size={16} />
                    </button>
                  ))}
                </div>
                {connectionPending && <div className="welcome-loading"><LoaderCircle className="spin" size={16} /> 正在连接</div>}
              </section>
            ) : (
              <>
                <div className="welcome-icon"><HardDrive size={25} /></div>
                <h1>{profiles.length ? '选择服务器以浏览文件' : '添加一台服务器'}</h1>
                <p>{profiles.length ? '选择左侧的服务器建立连接' : '保存 SSH 连接信息，开始浏览远程目录'}</p>
                {profiles.length === 0 && <button className="primary-button" onClick={() => openProfileDialog('create')}><Plus size={16} /> 添加服务器</button>}
                {connectionPending && <div className="welcome-loading"><LoaderCircle className="spin" size={16} /> 正在连接</div>}
              </>
            )}
          </div>
        )}

        {entryContextMenu && (
          <div
            className="entry-context-menu"
            ref={contextMenuRef}
            role="menu"
            aria-label={`${entryContextMenu.entry.name}的操作`}
            style={{ left: entryContextMenu.x, top: entryContextMenu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={handleContextMenuKeyDown}
          >
            {entryContextMenu.entry.type === 'file' && (
              <button
                className="entry-context-action preview-action"
                role="menuitem"
                onClick={() => {
                  const { entry } = entryContextMenu
                  setEntryContextMenu(null)
                  void previewFile(entry)
                }}
              >
                <Eye size={16} /> 预览
              </button>
            )}
            <button
              className="entry-context-action download-action"
              role="menuitem"
              onClick={() => {
                const { entry } = entryContextMenu
                setEntryContextMenu(null)
                void download(entry)
              }}
            >
              <ArrowDownToLine size={16} /> {entryContextMenu.entry.type === 'directory' ? '下载文件夹' : '下载文件'}
            </button>
          </div>
        )}

        {transferJobs.length > 0 && (
          <div className="transfer-tray">
            {transferJobs.map(([id, job]) => {
              const percent = job.total > 0 ? Math.min(100, Math.round(job.transferred * 100 / job.total)) : 0
              return (
                <div className="transfer-item" key={id}>
                  <div className={`transfer-state-icon ${job.finished ? 'complete' : ''}`}>
                    {job.finished ? <Check size={15} /> : job.direction === 'upload' ? <Upload size={15} /> : <ArrowDownToLine size={15} />}
                  </div>
                  <div className="transfer-copy">
                    <div className="transfer-line"><span>{job.name}</span><span>{job.finished ? '已完成' : `${percent}%`}</span></div>
                    <div className="progress-track"><div className={`progress-fill ${job.finished ? 'complete' : ''}`} style={{ width: `${job.finished ? 100 : percent}%` }} /></div>
                  </div>
                  <button className="icon-button subtle" title="隐藏传输状态" aria-label="隐藏传输状态" onClick={() => setTransfers((current) => {
                    const next = { ...current }
                    delete next[id]
                    return next
                  })}><X size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </main>

      <GlobalToast notice={toast} onDismiss={dismissToast} />

      {dialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><Server size={14} /> SSH / SFTP</div>
                <h2 id="profile-modal-title">{dialog.mode === 'create' ? '添加服务器' : '编辑服务器'}</h2>
              </div>
              <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={() => setDialog(null)}><X size={18} /></button>
            </div>
            <form onSubmit={(event) => void submitProfile(event)}>
              <label className="field">
                <span>连接名称</span>
                <input autoFocus required value={dialog.form.name} onChange={(event) => updateProfileForm({ name: event.target.value })} placeholder="例如：生产环境" />
              </label>
              <div className="field-row">
                <label className="field host-field">
                  <span>主机地址</span>
                  <input required value={dialog.form.host} onChange={(event) => updateProfileForm({ host: event.target.value })} placeholder="IP 地址或域名" autoCapitalize="none" />
                </label>
                <label className="field port-field">
                  <span>端口</span>
                  <input required type="number" min="1" max="65535" value={dialog.form.port} onChange={(event) => updateProfileForm({ port: event.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>用户名</span>
                <input required value={dialog.form.username} onChange={(event) => updateProfileForm({ username: event.target.value })} placeholder="Ubuntu 用户名" autoCapitalize="none" />
              </label>
              <label className="field">
                <span>SSH 密码</span>
                <div className="password-input-wrap">
                  <KeyRound size={15} />
                  <input required={dialog.mode === 'create'} type="password" autoComplete="new-password" value={dialog.form.password} onChange={(event) => updateProfileForm({ password: event.target.value })} placeholder={dialog.mode === 'edit' ? '留空以保留当前密码' : '输入登录密码'} />
                </div>
              </label>
              <div className="credential-hint"><ShieldCheck size={14} /> 密码将由 Windows 加密保存在此电脑</div>
              <div className="modal-footer">
                <button type="button" className="secondary-button" onClick={() => setDialog(null)}>取消</button>
                <button type="submit" className="primary-button"><Check size={15} /> 保存连接</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {settingsForm && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && !settingsSaving && setSettingsForm(null)}
        >
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><Settings size={14} /> 应用设置</div>
                <h2 id="settings-modal-title">文件预览上限</h2>
              </div>
              <button
                className="icon-button modal-close"
                title="关闭设置"
                aria-label="关闭设置"
                disabled={settingsSaving}
                onClick={() => setSettingsForm(null)}
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={(event) => void submitSettings(event)}>
              {previewLimitFields.map(({ key, label }) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input
                    required
                    type="number"
                    min="1"
                    max="1024"
                    step="1"
                    value={settingsForm[key]}
                    onChange={(event) => updateSettingsForm(key, event.target.value)}
                  />
                </label>
              ))}
              <div className="modal-footer">
                <button type="button" className="secondary-button" disabled={settingsSaving} onClick={() => setSettingsForm(null)}>
                  取消
                </button>
                <button type="submit" className="primary-button" disabled={settingsSaving}>
                  <Check size={15} /> 保存设置
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {previewDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closePreview()}>
          <section className={`modal preview-modal ${previewDialog.kind === 'ready' ? 'media-preview-modal' : ''}`} role="dialog" aria-modal="true" aria-labelledby="preview-modal-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><Eye size={14} /> 文件预览</div>
                <h2 id="preview-modal-title">
                  {previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name}
                </h2>
              </div>
              <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" onClick={closePreview}><X size={18} /></button>
            </div>
            {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取文件</div>}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'text' && (
              <pre className="preview-text">{previewDialog.result.content}</pre>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'image' && (
              <div className="preview-media"><img className="preview-image" src={previewDialog.result.url} alt={previewDialog.result.name} /></div>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'audio' && (
              <div className="preview-audio-wrap"><audio controls src={previewDialog.result.url}>浏览器不支持音频播放。</audio></div>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'video' && (
              <div className="preview-media"><video className="preview-video" controls src={previewDialog.result.url}>浏览器不支持视频播放。</video></div>
            )}
          </section>
        </div>
      )}

      {pendingHostKey && (
        <div className="modal-backdrop">
          <section className="modal fingerprint-modal" role="dialog" aria-modal="true" aria-labelledby="fingerprint-title">
            <div className="fingerprint-icon"><ShieldCheck size={24} /></div>
            <div className="modal-kicker centered">服务器身份校验</div>
            <h2 id="fingerprint-title">{pendingHostKey.previousFingerprint ? '服务器指纹已变化' : '确认服务器指纹'}</h2>
            <p className="fingerprint-host">{pendingHostKey.profile.username}@{pendingHostKey.profile.host}:{pendingHostKey.profile.port}</p>
            {pendingHostKey.previousFingerprint && (
              <div className="fingerprint-compare">
                <span>已保存</span><code>{pendingHostKey.previousFingerprint}</code>
              </div>
            )}
            <div className="fingerprint-compare new-fingerprint">
              <span>当前指纹</span><code>{pendingHostKey.fingerprint}</code>
            </div>
            <p className="fingerprint-note">请与服务器管理员提供的指纹核对后再继续。</p>
            <div className="modal-footer">
              <button className="secondary-button" onClick={() => setPendingHostKey(null)}>取消</button>
              <button className="primary-button" onClick={() => void trustAndReconnect()}>
                <ShieldCheck size={15} /> {pendingHostKey.previousFingerprint ? '更新并重连' : '信任并重连'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
