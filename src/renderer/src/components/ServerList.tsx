import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { FolderOpen, ChevronRight, HardDrive, LoaderCircle, Pencil, Pin, Plus, Server, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import type { ServerProfile, SessionKind } from '@shared/types'
import { formatDate } from '@/app-utils'

interface ServerContextMenuState {
  profile: ServerProfile
  x: number
  y: number
}

interface ServerListProps {
  profiles: { profile: ServerProfile; connectedAt?: number }[]
  connectionPending: boolean
  onAdd: () => void
  onConnect: (profile: ServerProfile, kind: SessionKind) => void
  onEdit: (profile: ServerProfile) => void
  onSetPinned: (profile: ServerProfile, pinned: boolean) => void
  onDelete: (profile: ServerProfile) => void
}

export default function ServerList({
  profiles,
  connectionPending,
  onAdd,
  onConnect,
  onEdit,
  onSetPinned,
  onDelete,
}: ServerListProps) {
  useLanguage()
  const [contextMenu, setContextMenu] = useState<ServerContextMenuState | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contextMenu) return

    const dismissOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    const dismiss = () => setContextMenu(null)

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
  }, [contextMenu])

  const openContextMenu = (event: MouseEvent<HTMLButtonElement>, profile: ServerProfile) => {
    event.preventDefault()
    if (connectionPending) return
    const menuWidth = 204
    const menuHeight = 80
    const inset = 8
    setContextMenu({
      profile,
      x: Math.max(inset, Math.min(event.clientX, window.innerWidth - menuWidth - inset)),
      y: Math.max(inset, Math.min(event.clientY, window.innerHeight - menuHeight - inset)),
    })
  }

  return (
    <div className="welcome-state welcome-servers">
      <section className="server-connections" aria-labelledby="server-connections-title">
        <div className="server-list-heading">
          <div className="server-list-title-group">
            <div className="server-list-heading-icon"><Server size={18} /></div>
            <h1 id="server-connections-title">{tr('settings.server')}</h1>
          </div>
          <button className="primary-button" onClick={onAdd}>
            <Plus size={16} />{tr('connections.addServer')}</button>
        </div>
        {profiles.length ? (
          <div className="server-list">
            {profiles.map(({ profile, connectedAt }) => (
              <div className="server-entry" key={profile.id}>
                <button
                  className="server-entry-connect"
                  disabled={connectionPending}
                  onClick={() => onConnect(profile, 'files')}
                  onContextMenu={(event) => openContextMenu(event, profile)}
                >
                  <span className="server-entry-icon"><Server size={17} /></span>
                  <span className="server-entry-copy">
                    <span className="server-entry-name">{profile.name}</span>
                    <span className="server-entry-address">{profile.username}@{profile.host}:{profile.port}</span>
                  </span>
                  <span className="server-entry-connected-at">
                    {connectedAt === undefined ? tr('connections.notConnected') : formatDate(new Date(connectedAt).toISOString())}
                  </span>
                  <ChevronRight className="server-entry-chevron" size={16} />
                </button>
                <div className="server-entry-actions">
                  <button
                    className={'icon-button subtle server-entry-pin' + (profile.pinned ? ' is-pinned' : '')}
                    title={profile.pinned ? tr('connections.unpin') : tr('connections.pinServer')}
                    aria-label={profile.pinned ? tr('connections.unpin2', { "name": profile.name }) : tr('connections.pin', { "name": profile.name })}
                    aria-pressed={profile.pinned}
                    onClick={() => onSetPinned(profile, !profile.pinned)}
                  >
                    <Pin size={14} />
                  </button>
                  <button className="icon-button subtle" title={tr('connections.editConnection')} aria-label={tr('connections.edit', { "name": profile.name })} onClick={() => onEdit(profile)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-button subtle danger-hover" title={tr('connections.deleteConnection')} aria-label={tr('settings.delete', { "name": profile.name })} onClick={() => onDelete(profile)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-server-list">
            <div className="welcome-icon"><HardDrive size={25} /></div>
            <h2>{tr('connections.noServersConfigured')}</h2>
            <p>{tr('connections.addSshConnectionDetailsToBrowseRemoteDirectories')}</p>
          </div>
        )}
        {connectionPending && <div className="welcome-loading"><LoaderCircle className="spin" size={16} />{tr('connections.connecting')}</div>}
      </section>
      {contextMenu && (
        <div
          className="browser-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={tr('connections.connectionTypeFor', { "name": contextMenu.profile.name })}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button className="entry-context-action" role="menuitem" onClick={() => onConnect(contextMenu.profile, 'files')}>
            <FolderOpen size={16} />{tr('common.fileManager')}</button>
          <button className="entry-context-action" role="menuitem" onClick={() => onConnect(contextMenu.profile, 'terminal')}>
            <Terminal size={16} />{tr('settings.sshTerminal')}</button>
        </div>
      )}
    </div>
  )
}
