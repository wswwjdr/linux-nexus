import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  File,
  Folder,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react'
import type {
  ConnectResult,
  DownloadProgress,
  RemoteEntry,
  SaveProfileInput,
  ServerProfile,
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

interface DownloadJob {
  name: string
  transferred: number
  total: number
  finished: boolean
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
  const [connectionMessage, setConnectionMessage] = useState('')
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; form: ProfileForm } | null>(null)
  const [pendingHostKey, setPendingHostKey] = useState<PendingHostKey | null>(null)
  const [downloads, setDownloads] = useState<Record<string, DownloadJob>>({})

  const connectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectedProfileId) ?? null,
    [profiles, connectedProfileId],
  )

  const refreshProfiles = async () => {
    setProfiles(await window.remoteFiles.listProfiles())
  }

  useEffect(() => {
    void window.remoteFiles.listProfiles().then(setProfiles).catch((error) => setConnectionMessage(errorMessage(error)))
  }, [])

  useEffect(() => {
    const removeProgressListener = window.remoteFiles.onDownloadProgress((progress: DownloadProgress) => {
      setDownloads((current) => ({
        ...current,
        [progress.requestId]: {
          name: current[progress.requestId]?.name ?? progress.remotePath.split('/').pop() ?? '文件',
          transferred: progress.transferred,
          total: progress.total,
          finished: false,
        },
      }))
    })
    const removeClosedListener = window.remoteFiles.onConnectionClosed((event) => {
      if (event.profileId !== connectedProfileId) return
      setConnectedProfileId(null)
      setEntries([])
      setConnectionMessage(`连接已断开：${event.message}`)
    })
    return () => {
      removeProgressListener()
      removeClosedListener()
    }
  }, [connectedProfileId])

  const loadDirectory = async (profileId: string, remotePath: string) => {
    setLoading(true)
    try {
      const nextEntries = await window.remoteFiles.listDirectory(profileId, remotePath)
      setEntries(nextEntries)
      setCurrentPath(remotePath)
      setConnectionMessage('')
    } catch (error) {
      setConnectionMessage(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const connectTo = async (profile: ServerProfile) => {
    setSelectedProfileId(profile.id)
    setConnectionPending(true)
    setConnectionMessage('')
    setEntries([])
    setConnectedProfileId(null)
    try {
      const result = await window.remoteFiles.connect(profile.id)
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
          setConnectionMessage(connectFailureText(result))
        }
        return
      }
      setConnectedProfileId(profile.id)
      await loadDirectory(profile.id, result.path)
    } catch (error) {
      setConnectionMessage(errorMessage(error))
    } finally {
      setConnectionPending(false)
    }
  }

  const navigate = (remotePath: string) => {
    if (!connectedProfileId) return
    void loadDirectory(connectedProfileId, remotePath)
  }

  const openProfileDialog = (mode: 'create' | 'edit', profile?: ServerProfile) => {
    setConnectionMessage('')
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
        setConnectedProfileId(null)
        setEntries([])
      }
      setSelectedProfileId(savedProfile.id)
      setDialog(null)
      setConnectionMessage('')
    } catch (error) {
      setConnectionMessage(errorMessage(error))
    }
  }

  const removeProfile = async (profile: ServerProfile) => {
    if (!window.confirm(`删除“${profile.name}”的连接配置？`)) return
    try {
      await window.remoteFiles.deleteProfile(profile.id)
      if (connectedProfileId === profile.id) {
        setConnectedProfileId(null)
        setEntries([])
      }
      if (selectedProfileId === profile.id) setSelectedProfileId(null)
      await refreshProfiles()
    } catch (error) {
      setConnectionMessage(errorMessage(error))
    }
  }

  const disconnect = async () => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    await window.remoteFiles.disconnect(profileId)
    setConnectedProfileId(null)
    setEntries([])
    setConnectionMessage('')
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
      setConnectionMessage(errorMessage(error))
    }
  }

  const download = async (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    const requestId = crypto.randomUUID()
    setDownloads((current) => ({
      ...current,
      [requestId]: { name: entry.name, transferred: 0, total: entry.size, finished: false },
    }))
    try {
      const saved = await window.remoteFiles.downloadFile(requestId, connectedProfileId, entry.path)
      if (!saved) {
        setDownloads((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
        return
      }
      setDownloads((current) => ({
        ...current,
        [requestId]: { ...current[requestId], transferred: entry.size, total: entry.size, finished: true },
      }))
      window.setTimeout(() => {
        setDownloads((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      }, 2800)
    } catch (error) {
      setDownloads((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      setConnectionMessage(`下载失败：${errorMessage(error)}`)
    }
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

  const downloadJobs = Object.entries(downloads)

  return (
    <div className="app-shell">
      <aside className="sidebar">
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
            <div className="page-title">文件</div>
            {connectedProfile && <span className="topbar-separator" />}
            {connectedProfile && <span className="connected-host"><Cloud size={14} /> {connectedProfile.username}@{connectedProfile.host}</span>}
          </div>
          <div className="topbar-actions">
            {connectedProfileId ? (
              <>
                <button className="icon-button toolbar-button" title="刷新目录" aria-label="刷新目录" disabled={loading} onClick={() => navigate(currentPath)}>
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
              <button className="icon-button path-nav" title="返回上级目录" aria-label="返回上级目录" disabled={currentPath === '/'} onClick={() => navigate(getParentPath(currentPath))}>
                <ArrowUp size={16} />
              </button>
              <button className="icon-button path-nav back-nav" title="返回根目录" aria-label="返回根目录" disabled={currentPath === '/'} onClick={() => navigate('/')}>
                <ArrowLeft size={16} />
              </button>
              <nav className="breadcrumbs" aria-label="当前路径">
                {breadcrumbs.map((crumb, index) => (
                  <span className="breadcrumb-piece" key={crumb.path}>
                    {index > 0 && <ChevronRight size={13} />}
                    <button className={index === breadcrumbs.length - 1 ? 'current-crumb' : ''} onClick={() => navigate(crumb.path)}>{crumb.label}</button>
                  </span>
                ))}
              </nav>
              <div className="path-count">{entries.length} 项</div>
            </div>

            <div className="file-table-wrap">
              <table className="file-table">
                <thead>
                  <tr>
                    <th className="name-col">名称</th>
                    <th className="type-col">类型</th>
                    <th className="size-col">大小</th>
                    <th className="date-col">修改时间</th>
                    <th className="permission-col">权限</th>
                    <th className="action-col"><span className="visually-hidden">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr className="file-row" key={entry.path}>
                      <td className="name-col">
                        <button className={`entry-name ${entry.type === 'directory' ? 'directory-entry' : ''}`} onClick={() => entry.type === 'directory' && navigate(entry.path)} disabled={entry.type !== 'directory'}>
                          <span className={`entry-icon ${entry.type === 'directory' ? 'folder-icon' : ''}`}>
                            {entry.type === 'directory' ? <Folder size={17} fill="currentColor" strokeWidth={1.8} /> : <File size={16} />}
                          </span>
                          <span className="entry-label">{entry.name}</span>
                        </button>
                      </td>
                      <td className="type-col">{entry.type === 'directory' ? '文件夹' : entry.type === 'symlink' ? '链接' : entry.type === 'file' ? '文件' : '其他'}</td>
                      <td className="size-col">{entry.type === 'directory' ? '—' : formatSize(entry.size)}</td>
                      <td className="date-col">{formatDate(entry.modifiedAt)}</td>
                      <td className="permission-col"><code>{entry.permissions}</code></td>
                      <td className="action-col">
                        {entry.type !== 'directory' && (
                          <button className="icon-button download-button" title="下载文件" aria-label={`下载 ${entry.name}`} onClick={() => void download(entry)}>
                            <ArrowDownToLine size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {loading && (
                <div className="table-state"><LoaderCircle className="spin" size={19} /> 正在读取目录</div>
              )}
              {!loading && entries.length === 0 && (
                <div className="table-state empty-directory"><Folder size={22} /> 此目录为空</div>
              )}
            </div>
          </>
        ) : (
          <div className="welcome-state">
            <div className="welcome-icon"><HardDrive size={25} /></div>
            <h1>{profiles.length ? '选择服务器以浏览文件' : '添加一台服务器'}</h1>
            <p>{profiles.length ? '选择左侧的服务器建立连接' : '保存 SSH 连接信息，开始浏览远程目录'}</p>
            {profiles.length === 0 && <button className="primary-button" onClick={() => openProfileDialog('create')}><Plus size={16} /> 添加服务器</button>}
            {connectionPending && <div className="welcome-loading"><LoaderCircle className="spin" size={16} /> 正在连接</div>}
          </div>
        )}

        {connectionMessage && (
          <div className="message-banner" role="status">
            <CircleAlert size={16} />
            <span>{connectionMessage}</span>
            <button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => setConnectionMessage('')}><X size={15} /></button>
          </div>
        )}

        {downloadJobs.length > 0 && (
          <div className="download-tray">
            {downloadJobs.map(([id, job]) => {
              const percent = job.total > 0 ? Math.min(100, Math.round(job.transferred * 100 / job.total)) : 0
              return (
                <div className="download-item" key={id}>
                  <div className={`download-state-icon ${job.finished ? 'complete' : ''}`}>
                    {job.finished ? <Check size={15} /> : <ArrowDownToLine size={15} />}
                  </div>
                  <div className="download-copy">
                    <div className="download-line"><span>{job.name}</span><span>{job.finished ? '已完成' : `${percent}%`}</span></div>
                    <div className="progress-track"><div className={`progress-fill ${job.finished ? 'complete' : ''}`} style={{ width: `${job.finished ? 100 : percent}%` }} /></div>
                  </div>
                  <button className="icon-button subtle" title="隐藏下载状态" aria-label="隐藏下载状态" onClick={() => setDownloads((current) => {
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
