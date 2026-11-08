import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useEffect, useState } from 'react'
import { FolderOpen, Terminal, X } from 'lucide-react'
import type { ServerProfile, SessionKind } from '@shared/types'

interface SessionChooserProps {
  profiles: ServerProfile[]
  onClose: () => void
  onCreate: (profileId: string, kind: SessionKind) => void
}

export default function SessionChooser({ profiles, onClose, onCreate }: SessionChooserProps) {
  useLanguage()
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const [kind, setKind] = useState<SessionKind>('files')

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
    <div className="modal-backdrop session-launcher-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="modal session-launcher" role="dialog" aria-modal="true" aria-labelledby="session-launcher-title">
        <header className="session-launcher-header">
          <h2 id="session-launcher-title">{tr('connections.newSession')}</h2>
          <button className="icon-button subtle" title={tr('common.close')} aria-label={tr('common.close')} onClick={onClose}><X size={15} /></button>
        </header>
        {profiles.length ? (
          <>
            <label className="session-launcher-label" htmlFor="session-profile">{tr('settings.server')}</label>
            <select id="session-profile" autoFocus value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name} · {profile.username}@{profile.host}</option>
              ))}
            </select>
            <span className="session-launcher-label">{tr('settings.connectionType')}</span>
            <div className="session-kind-switch" role="group" aria-label={tr('settings.connectionType')}>
              <button type="button" aria-pressed={kind === 'files'} onClick={() => setKind('files')}>
                <FolderOpen size={16} />{tr('common.fileManager')}</button>
              <button type="button" aria-pressed={kind === 'terminal'} onClick={() => setKind('terminal')}>
                <Terminal size={16} />{tr('settings.sshTerminal')}</button>
            </div>
            <footer className="session-launcher-actions">
              <button className="text-button" onClick={onClose}>{tr('common.cancel')}</button>
              <button className="text-button primary-action" disabled={!profileId} onClick={() => onCreate(profileId, kind)}>{tr('connections.connect')}</button>
            </footer>
          </>
        ) : (
          <div className="session-launcher-empty">
            <p>{tr('connections.noSavedServersCloseThisWindowAndAddOneFrom')}</p>
          </div>
        )}
      </section>
    </div>
  )
}
