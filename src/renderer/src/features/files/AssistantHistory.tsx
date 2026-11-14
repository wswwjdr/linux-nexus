import { useState, type FormEvent } from 'react'
import { Ellipsis, History, MessageSquare, Pencil, Plus, Search, Square, Trash2, X } from 'lucide-react'
import { formatLocale, messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { AssistantConversation, AssistantSnapshot } from '@shared/types/assistant'
import { AssistantDecision } from '../../components/dialogs/AssistantDecision'

/**
 * @param chat The conversation whose title is needed.
 * @returns The saved title, or a fallback based on the first message.
 */
export function chatTitle(chat: AssistantConversation): string {
  return chat.title ?? chat.turns[0]?.prompt.slice(0, 100) ?? tr('assistant.newChat')
}

/**
 * @param date The conversation's latest activity date.
 * @param today The reference date shared by all rows in the current render.
 * @returns A relative day label or a localized calendar date.
 */
function dayLabel(date: Date, today: Date): string {
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return tr('assistant.today')
  if (date.toDateString() === yesterday.toDateString()) return tr('assistant.yesterday')
  return date.toLocaleDateString(formatLocale())
}

interface Props {
  id: string
  sessionId: string
  snapshot?: AssistantSnapshot
  selectedId: string
  loading: boolean
  onSelect: (id: string) => void
  onClose: () => void
}

/**
 * Displays searchable conversations and scopes every action to its own row.
 * @param props The owning session, current snapshot and history navigation callbacks.
 * @returns The sidebar or drawer with activity and conversation controls.
 */
export function AssistantHistory({ id, sessionId, snapshot, selectedId, loading, onSelect, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [rename, setRename] = useState<{ id: string; title: string }>()
  const [deleteId, setDeleteId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleteChat = snapshot?.conversations.find((chat) => chat.id === deleteId)
  const groups = new Map<string, AssistantConversation[]>()
  const running = new Map(snapshot?.running.map((task) => [task.conversationId, task]))
  const search = query.trim().toLocaleLowerCase()
  const today = new Date()
  const activityTime = new Intl.DateTimeFormat(formatLocale(), { hour: '2-digit', minute: '2-digit' })
  for (const chat of snapshot?.conversations ?? []) {
    if (!chatTitle(chat).toLocaleLowerCase().includes(search)) continue
    const label = dayLabel(new Date(chat.updatedAt), today)
    const group = groups.get(label)
    if (group) group.push(chat)
    else groups.set(label, [chat])
  }

  /**
   * Runs one history mutation and keeps the current edit or confirmation on failure.
   * @param action The mutation to execute.
   * @returns A promise that settles after the pending state and any error are shown.
   */
  async function run(action: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(renderMessage(messageFromUnknown(reason)))
    } finally {
      setBusy(false)
    }
  }

  /** Cancels the current rename and clears its error. */
  function cancelRename(): void {
    if (busy) return
    setRename(undefined)
    setError('')
  }

  /**
   * Saves the title for the edited row while keeping the current selection.
   * @param event The rename form submission.
   */
  function saveTitle(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!rename?.title.trim() || busy) return
    void run(async () => {
      await window.remoteFiles.assistant({ action: 'renameConversation', input: { sessionId, conversationId: rename.id, title: rename.title.trim() } })
      setRename(undefined)
    })
  }

  return <aside id={id} className="assistant-history" aria-labelledby={`${id}-heading`}>
    <header className="assistant-history-header">
      <div className="assistant-history-heading">
        <h2 id={`${id}-heading`}>{tr('assistant.history')}</h2>
        <button type="button" className="icon-button" aria-label={tr('common.close')} onClick={onClose}><X size={16} /></button>
      </div>
      <button type="button" className="primary-button assistant-history-new" disabled={!snapshot} onClick={() => onSelect('')}>
        <Plus size={16} />{tr('assistant.newChat')}
      </button>
      <div className="assistant-history-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" aria-label={tr('assistant.searchHistory')} placeholder={tr('assistant.searchHistory')}
          value={query} onChange={(event) => { cancelRename(); setQuery(event.target.value) }} />
      </div>
    </header>
    {error && !deleteChat && <p role="alert" className="confirmation-error assistant-history-error">{error}</p>}
    <div className="assistant-history-list">
      {(loading || (snapshot && !groups.size)) && <p className="assistant-history-empty" role="status">
        {search ? <Search size={22} aria-hidden="true" /> : <History size={22} aria-hidden="true" />}
        {tr(loading ? 'assistant.historyLoading' : search ? 'assistant.historyNoResults' : 'assistant.historyEmpty')}
      </p>}
      {[...groups].map(([day, chats]) => <section key={day} className="assistant-history-group">
        <h3>{day}</h3>
        <ul>
          {chats.map((chat) => {
            const title = chatTitle(chat)
            const last = chat.turns.at(-1)
            const active = running.get(chat.id)
            const status = last?.approvals.length ? 'pending' : last?.questions.length ? 'question' :
              active ? 'running' : last?.tools.some((tool) => tool.status === 'unknown') ? 'unknown' : last?.status
            const date = new Date(chat.updatedAt)
            const menuId = `${id}-actions-${chat.id}`
            if (rename?.id === chat.id) return <li key={chat.id}>
              <form className="assistant-rename" onSubmit={saveTitle}
                onKeyDown={(event) => { if (event.key === 'Escape') cancelRename() }}>
                <input autoFocus aria-label={tr('assistant.rename')} maxLength={120} value={rename.title} disabled={busy}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setRename({ ...rename, title: event.target.value })} />
                <div className="assistant-rename-actions">
                  <button type="submit" className="primary-button" disabled={busy || !rename.title.trim()}>{tr('assistant.save')}</button>
                  <button type="button" className="text-button" disabled={busy} onClick={cancelRename}>{tr('assistant.cancel')}</button>
                </div>
              </form>
            </li>
            return <li key={chat.id} className="assistant-history-item">
              <button type="button" className="assistant-history-chat" aria-current={chat.id === selectedId ? 'true' : undefined}
                title={title} onClick={() => onSelect(chat.id)}>
                <MessageSquare size={16} className="assistant-history-glyph" aria-hidden="true" />
                <span className="assistant-history-copy">
                  <span className="assistant-history-title">{title}</span>
                  <span className="assistant-history-meta">
                    <time dateTime={date.toISOString()}>{activityTime.format(date)}</time>
                    {status && <span className="assistant-history-status" data-status={status}>{tr(`assistant.${status}`)}</span>}
                  </span>
                </span>
              </button>
              <button type="button" className="icon-button assistant-history-more" popoverTarget={menuId}
                aria-label={tr('assistant.chatActions', { title })}><Ellipsis size={16} /></button>
              <div id={menuId} popover="auto" className="assistant-history-menu">
                <button type="button" disabled={busy} popoverTarget={menuId} popoverTargetAction="hide" onClick={() => {
                  setError(''); setRename({ id: chat.id, title: title.slice(0, 120) })
                }}><Pencil size={14} />{tr('assistant.rename')}</button>
                {active && <button type="button" disabled={busy} popoverTarget={menuId} popoverTargetAction="hide"
                  onClick={() => void run(async () => {
                    await window.remoteFiles.assistant({ action: 'stop', input: { sessionId: active.sessionId, taskId: active.taskId } })
                  })}><Square size={14} />{tr('assistant.stop')}</button>}
                <button type="button" className="assistant-history-delete" disabled={busy || !!active}
                  title={active ? tr('assistant.stopBeforeDelete') : undefined} popoverTarget={menuId} popoverTargetAction="hide"
                  onClick={() => { setError(''); setDeleteId(chat.id) }}><Trash2 size={14} />{tr('assistant.deleteConversation')}</button>
              </div>
            </li>
          })}
        </ul>
      </section>)}
    </div>
    {deleteChat && <AssistantDecision title={tr('assistant.deleteNamed', { title: chatTitle(deleteChat) })}
      onCancel={() => { if (!busy) { setDeleteId(''); setError('') } }}
      actions={<>
        <button type="button" data-initial-focus className="text-button" disabled={busy}
          onClick={() => { setDeleteId(''); setError('') }}>{tr('assistant.cancel')}</button>
        <button type="button" className="primary-button" disabled={busy || snapshot?.running.some((task) => task.conversationId === deleteId)}
          onClick={() => void run(async () => {
            await window.remoteFiles.assistant({ action: 'deleteConversation', input: { sessionId, conversationId: deleteId } })
            setDeleteId('')
          })}>{tr('assistant.deleteConversation')}</button>
      </>}>
      {deleteChat.turns.some((turn) => turn.tools.some((tool) => tool.status === 'unknown')) && <p>{tr('assistant.deleteUnknown')}</p>}
      {error && <p role="alert" className="confirmation-error">{error}</p>}
    </AssistantDecision>}
  </aside>
}
