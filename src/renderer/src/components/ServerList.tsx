import { ChevronRight, HardDrive, LoaderCircle, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import type { ServerProfile } from '@shared/types'
import { formatDate } from '../app-utils'

interface ServerListProps {
  profiles: { profile: ServerProfile; connectedAt?: number }[]
  connectionPending: boolean
  onAdd: () => void
  onConnect: (profile: ServerProfile) => void
  onEdit: (profile: ServerProfile) => void
  onDelete: (profile: ServerProfile) => void
}

export default function ServerList({
  profiles,
  connectionPending,
  onAdd,
  onConnect,
  onEdit,
  onDelete,
}: ServerListProps) {
  return (
    <div className="welcome-state welcome-servers">
      <section className="server-connections" aria-labelledby="server-connections-title">
        <div className="server-list-heading">
          <div className="server-list-title-group">
            <div className="server-list-heading-icon"><Server size={18} /></div>
            <h1 id="server-connections-title">服务器</h1>
          </div>
          <button className="primary-button" onClick={onAdd}>
            <Plus size={16} /> 添加服务器
          </button>
        </div>
        {profiles.length ? (
          <div className="server-list">
            {profiles.map(({ profile, connectedAt }) => (
              <div className="server-entry" key={profile.id}>
                <button className="server-entry-connect" disabled={connectionPending} onClick={() => onConnect(profile)}>
                  <span className="server-entry-icon"><Server size={17} /></span>
                  <span className="server-entry-copy">
                    <span className="server-entry-name">{profile.name}</span>
                    <span className="server-entry-address">{profile.username}@{profile.host}:{profile.port}</span>
                  </span>
                  <span className="server-entry-connected-at">
                    {connectedAt === undefined ? '尚未连接' : formatDate(new Date(connectedAt).toISOString())}
                  </span>
                  <ChevronRight className="server-entry-chevron" size={16} />
                </button>
                <div className="server-entry-actions">
                  <button className="icon-button subtle" title="编辑连接" aria-label={'编辑 ' + profile.name} onClick={() => onEdit(profile)}>
                    <Pencil size={14} />
                  </button>
                  <button className="icon-button subtle danger-hover" title="删除连接" aria-label={'删除 ' + profile.name} onClick={() => onDelete(profile)}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-server-list">
            <div className="welcome-icon"><HardDrive size={25} /></div>
            <h2>还没有服务器配置</h2>
            <p>添加 SSH 连接信息以开始浏览远程目录</p>
          </div>
        )}
        {connectionPending && <div className="welcome-loading"><LoaderCircle className="spin" size={16} /> 正在连接</div>}
      </section>
    </div>
  )
}
