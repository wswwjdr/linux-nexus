import { useEffect, useState } from 'react'
import { FolderOpen, Terminal, X } from 'lucide-react'
import type { ServerProfile, SessionKind } from '@shared/types'

interface SessionChooserProps {
  profiles: ServerProfile[]
  onClose: () => void
  onCreate: (profileId: string, kind: SessionKind) => void
}

export default function SessionChooser({ profiles, onClose, onCreate }: SessionChooserProps) {
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const [kind, setKind] = useState<SessionKind>('sftp')

  useEffect(() => {
    if (profiles.some((profile) => profile.id === profileId)) return
    setProfileId(profiles[0]?.id ?? '')
  }, [profiles, profileId])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [onClose])

  return (
    <div className="session-launcher-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="session-launcher" role="dialog" aria-modal="true" aria-labelledby="session-launcher-title">
        <header className="session-launcher-header">
          <h2 id="session-launcher-title">新建会话</h2>
          <button className="icon-button subtle" title="关闭" aria-label="关闭" onClick={onClose}><X size={15} /></button>
        </header>
        {profiles.length ? (
          <>
            <label className="session-launcher-label" htmlFor="session-profile">服务器</label>
            <select id="session-profile" autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name} · {profile.username}@{profile.host}</option>
              ))}
            </select>
            <span className="session-launcher-label">连接方式</span>
            <div className="session-kind-switch" role="group" aria-label="连接方式">
              <button type="button" aria-pressed={kind === 'sftp'} onClick={() => setKind('sftp')}>
                <FolderOpen size={16} /> SFTP 文件管理
              </button>
              <button type="button" aria-pressed={kind === 'terminal'} onClick={() => setKind('terminal')}>
                <Terminal size={16} /> SSH 终端
              </button>
            </div>
            <footer className="session-launcher-actions">
              <button className="text-button" onClick={onClose}>取消</button>
              <button className="text-button primary-action" disabled={!profileId} onClick={() => onCreate(profileId, kind)}>连接</button>
            </footer>
          </>
        ) : (
          <div className="session-launcher-empty">
            <p>还没有已保存的服务器，请关闭此窗口并返回主页添加。</p>
          </div>
        )}
      </section>
    </div>
  )
}
