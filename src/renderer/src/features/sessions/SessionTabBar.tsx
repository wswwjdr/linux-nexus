import { useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { FolderOpen, LoaderCircle, Plus, Terminal, X } from 'lucide-react'
import type { ServerProfile } from '@shared/types'
import type { SessionTab } from '../../app-types'
import type { useSessionOperations } from './useSessionOperations'

const sessionTabMime = 'application/x-linux-nexus-session-tab'
type DropTarget = { sessionId: string; placement: 'before' | 'after' }

interface SessionTabBarProps {
  sessions: SessionTab[]
  profiles: ServerProfile[]
  activeSessionId: string | null
  actions: Pick<ReturnType<typeof useSessionOperations>,
    'closeSession' | 'activateSession' | 'openSessionContextMenu' | 'handleSessionTabContextMenuKeyDown' | 'reorderSession'>
  onAdd: () => void
}

export default function SessionTabBar({ sessions, profiles, activeSessionId, actions, onAdd }: SessionTabBarProps) {
  const draggedIdRef = useRef<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const movedButtonRef = useRef<HTMLButtonElement | null>(null)

  useLayoutEffect(() => {
    const button = movedButtonRef.current
    if (!button) return
    button.focus()
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    movedButtonRef.current = null
  }, [sessions])

  const finishDrag = () => {
    draggedIdRef.current = null
    setDraggedId(null)
    setDropTarget(null)
  }

  const getDropTarget = (event: DragEvent<HTMLDivElement>): DropTarget | null => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]')
    if (tab) {
      const bounds = tab.getBoundingClientRect()
      return { sessionId: tab.dataset.sessionId!, placement: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after' }
    }
    const last = sessions.at(-1)
    return last ? { sessionId: last.id, placement: 'after' } : null
  }

  const isSessionDrag = (event: DragEvent<HTMLDivElement>) =>
    draggedIdRef.current !== null && event.dataTransfer.types.includes(sessionTabMime)

  return (
    <nav className="session-tabbar" role="tablist" aria-label="会话标签">
      <div
        className="session-tab-list"
        onDragOver={(event) => {
          if (!isSessionDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          setDropTarget(getDropTarget(event))
          const list = event.currentTarget
          const bounds = list.getBoundingClientRect()
          if (event.clientX < bounds.left + 28) list.scrollLeft -= 20
          else if (event.clientX > bounds.right - 28) list.scrollLeft += 20
        }}
        onDragLeave={(event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null)
        }}
        onDrop={(event) => {
          if (!isSessionDrag(event)) return
          event.preventDefault()
          const target = getDropTarget(event)
          if (target) actions.reorderSession(draggedIdRef.current!, target.sessionId, target.placement)
          finishDrag()
        }}
        onDragEnd={finishDrag}
      >
        {sessions.map((session, index) => {
          const profile = profiles.find((candidate) => candidate.id === session.profileId)
          const isActive = activeSessionId === session.id
          const kindLabel = session.kind === 'files' ? '文件管理' : 'SSH'
          const sameKindSessions = sessions.filter((candidate) =>
            candidate.profileId === session.profileId && candidate.kind === session.kind)
          const duplicateIndex = sameKindSessions.findIndex((candidate) => candidate.id === session.id)
          const baseLabel = profile?.name ?? '服务器'
          const label = sameKindSessions.length > 1 ? `${baseLabel} (${duplicateIndex + 1})` : baseLabel
          const title = `${label} · ${kindLabel}${session.kind === 'files' ? ' · ' + session.currentPath : ''} · 拖动调整顺序`
          const dropClass = dropTarget?.sessionId === session.id && draggedId !== session.id
            ? ' drop-' + dropTarget.placement : ''
          return (
            <div
              className={'session-tab' + (isActive ? ' active' : '') + (draggedId === session.id ? ' dragging' : '') + dropClass}
              key={session.id}
              data-session-id={session.id}
              onMouseDown={(event) => {
                if (event.button !== 1) return
                event.preventDefault()
                actions.closeSession(session.id)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                actions.openSessionContextMenu(session.id, event.clientX, event.clientY)
              }}
            >
              <button
                className="session-tab-select"
                id={'session-tab-' + session.id}
                role="tab"
                aria-selected={isActive}
                aria-controls={'session-panel-' + session.id}
                aria-keyshortcuts="Control+Shift+ArrowLeft Control+Shift+ArrowRight"
                title={title}
                draggable={sessions.length > 1}
                onDragStart={(event) => {
                  draggedIdRef.current = session.id
                  event.dataTransfer.setData(sessionTabMime, session.id)
                  event.dataTransfer.effectAllowed = 'move'
                  setDraggedId(session.id)
                }}
                onClick={() => actions.activateSession(session.id)}
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey
                    && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                    event.preventDefault()
                    const offset = event.key === 'ArrowLeft' ? -1 : 1
                    const target = sessions[index + offset]
                    if (target) {
                      movedButtonRef.current = event.currentTarget
                      actions.reorderSession(session.id, target.id, offset === -1 ? 'before' : 'after')
                    }
                  } else {
                    actions.handleSessionTabContextMenuKeyDown(event, session.id)
                  }
                }}
              >
                {session.kind === 'files' ? <FolderOpen size={14} /> : <Terminal size={14} />}
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
                onClick={() => actions.closeSession(session.id)}
              ><X size={13} /></button>
            </div>
          )
        })}
      </div>
      <button className="icon-button session-add-button" title="新建会话" aria-label="新建会话" onClick={onAdd}>
        <Plus size={16} />
      </button>
    </nav>
  )
}
