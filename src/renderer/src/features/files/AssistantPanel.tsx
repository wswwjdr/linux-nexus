import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeftRight, History, Maximize2, Minimize2, Plus, X } from 'lucide-react'
import { messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { AssistantEvent, AssistantProvider, AssistantSnapshot } from '@shared/types/assistant'

import { AssistantMarkdown } from './AssistantMarkdown'
import { AssistantAnswer, AssistantExecution } from './AssistantExecution'
import { AssistantHistory, chatTitle } from './AssistantHistory'

const drafts = new Map<string, string>()

interface Props {
  sessionId: string
  server: string
  directory: string
  selectedPaths: string[]
  controls: { side: 'left' | 'right'; expanded: boolean; narrow: boolean; swap: () => void; expand: () => void }
  onOpenExternalLink: (url: string) => void
  onClose: () => void
  fileIdentity: 'login' | 'root-login' | 'sudo-root'
}

/** Applies an ordered turn, title or removal event to the corresponding server snapshot. */
function reduceEvent(snapshot: AssistantSnapshot, event: AssistantEvent): AssistantSnapshot {
  if (event.serverKey !== snapshot.serverKey || event.sequence <= snapshot.sequence) return snapshot
  if (event.kind === 'rename') return { ...snapshot, sequence: event.sequence,
    conversations: snapshot.conversations.map((chat) => chat.id === event.conversationId ? { ...chat, title: event.title } : chat) }
  if (event.kind === 'delete') return { ...snapshot, sequence: event.sequence,
    cleanupWarning: event.warning ?? snapshot.cleanupWarning,
    conversations: snapshot.conversations.filter(({ id }) => id !== event.conversationId) }
  const previous = snapshot.conversations.find(({ id }) => id === event.conversationId)
  const turns = previous?.turns.slice() ?? []
  const index = turns.findIndex(({ id }) => id === event.taskId)
  if (index === -1) turns.push(event.turn)
  else turns[index] = event.turn
  const conversation = { ...previous, id: event.conversationId, turns, updatedAt: event.updatedAt }
  return { ...snapshot, sequence: event.sequence,
    running: [
      ...snapshot.running.filter(({ taskId }) => taskId !== event.taskId),
      ...(event.turn.status === 'running' ? [{ sessionId: event.sessionId, conversationId: event.conversationId, taskId: event.taskId }] : []),
    ],
    conversations: [conversation, ...snapshot.conversations.filter(({ id }) => id !== event.conversationId)].sort((a, b) => b.updatedAt - a.updatedAt),
  }
}

/** Shows history and live task updates for the connected file tab and accepts reviewed edits. */
export function AssistantPanel({ sessionId, server, directory, selectedPaths, controls, onClose, onOpenExternalLink, fileIdentity }: Props) {
  const composer = useRef<HTMLTextAreaElement>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyId = useId()
  const panel = useRef<HTMLElement>(null)
  const [retry, setRetry] = useState(0)
  const [loadError, setLoadError] = useState('')
  const lastLoaded = useRef('')
  const transcript = useRef<HTMLDivElement>(null)
  const transcriptContent = useRef<HTMLDivElement>(null)
  const [snapshot, setSnapshot] = useState<AssistantSnapshot>()
  const [providers, setProviders] = useState<AssistantProvider[]>()
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [prompt, setPrompt] = useState('')
  const [shareHistory, setShareHistory] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const conversation = snapshot?.conversations.find(({ id }) => id === conversationId)
  const provider = providers?.find(({ id }) => id === providerId)
  const sharing = Boolean(provider && conversation?.turns.some((turn) => turn.providerId !== provider.id))
  const running = snapshot?.running.find((task) => task.conversationId === conversationId)
  const canSupplement = running?.sessionId === sessionId && running.conversationId === conversationId

  useLayoutEffect(() => {
    const view = transcript.current
    const content = transcriptContent.current
    if (!view || !content) return
    view.scrollTop = view.scrollHeight
    let previousEnd = view.scrollHeight - view.clientHeight
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const end = view.scrollHeight - view.clientHeight
      // Compare with the old end so growth below the viewport cannot hide a user's scroll.
      if (end > previousEnd && view.scrollTop >= previousEnd - 2) view.scrollTop = view.scrollHeight
      previousEnd = end
    })
    observer.observe(content)
    observer.observe(view)
    return () => observer.disconnect()
  }, [conversationId])

  useEffect(() => {
    let active = true
    const queued: AssistantEvent[] = []
    let loaded = false
    const unsubscribe = window.remoteFiles.onAssistantEvent((event) => {
      if (!loaded) queued.push(event)
      else setSnapshot((value) => value && reduceEvent(value, event))
    })
    void window.remoteFiles.assistant({ action: 'snapshot', input: { sessionId, refresh: retry > 0 } }).then((value) => {
      if (!active) return
      const latest = queued.reduce(reduceEvent, value)
      loaded = true
      setSnapshot(latest)
      const key = sessionId + ':' + latest.serverKey
      if (key !== lastLoaded.current) {
        const id = latest.running.find((task) => task.sessionId === sessionId)?.conversationId ?? latest.conversations[0]?.id ?? ''
        setConversationId(id)
        setPrompt(drafts.get(latest.serverKey + ':' + id) ?? '')
        lastLoaded.current = key
      }
    }).catch((reason: unknown) => { if (active) setLoadError(renderMessage(messageFromUnknown(reason))) })
    return () => { active = false; unsubscribe() }
  }, [sessionId, fileIdentity, retry])

  useEffect(() => {
    let active = true
    void window.remoteFiles.assistant({ action: 'settings', input: undefined }).then((value) => {
      if (!active) return
      setProviders(value.providers)
      setProviderId(value.providers[0]?.id ?? '')
      setModel(value.providers[0]?.defaultModel ?? '')
    }).catch((reason: unknown) => { if (active) setError(renderMessage(messageFromUnknown(reason))) })
    return () => { active = false }
  }, [sessionId])

  useEffect(() => {
    if (!snapshot || !conversationId || conversation) return
    const id = snapshot.conversations[0]?.id ?? ''
    drafts.delete(snapshot.serverKey + ':' + conversationId)
    setConversationId(id)
    setPrompt(drafts.get(snapshot.serverKey + ':' + id) ?? '')
    setShareHistory(false)
  }, [snapshot, conversationId, conversation])

  /** Runs a dialog action and displays any localized IPC error. */
  async function run(action: () => Promise<void>): Promise<void> {
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

  /** Sends the current prompt and its visible directory context to the main process. */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!snapshot || !prompt.trim() || busy) return
    if (running) {
      if (canSupplement) void run(async () => {
        await window.remoteFiles.assistant({ action: 'supplement', input: { sessionId, taskId: running.taskId, text: prompt.trim() } })
        changePrompt('')
      })
      return
    }
    if (!provider || !model || (sharing && !shareHistory)) return
    void run(async () => {
      const started = await window.remoteFiles.assistant({ action: 'start', input: { sessionId, directory, selectedPaths,
        conversationId: conversationId || undefined, providerId, model, prompt: prompt.trim(), shareHistory } })
      const latest = await window.remoteFiles.assistant({ action: 'snapshot', input: { sessionId } })
      setSnapshot((current) => !current || latest.sequence >= current.sequence ? latest : current)
      setConversationId(started.conversationId)
      changePrompt('')
      setShareHistory(false)
    })
  }

  const identity = snapshot?.identity === 'root-login' ? 'assistant.identityRoot'
    : snapshot?.identity === 'sudo-root' ? 'assistant.identitySudo' : 'assistant.identityLogin'
  const historyIssues = snapshot?.historyIssues ?? []

  /** Retries loading the server history from disk without closing the current conversation. */
  function retryHistory(): void {
    setLoadError('')
    setRetry((value) => value + 1)
  }

  /** Updates the draft for the active server and conversation in renderer memory. */
  function changePrompt(text: string): void {
    setPrompt(text)
    if (!snapshot) return
    const key = snapshot.serverKey + ':' + conversationId
    if (text) drafts.set(key, text)
    else drafts.delete(key)
  }

  /** Selects the given conversation and restores its draft; closes the drawer on narrow panels. */
  function selectChat(id: string): void {
    setConversationId(id)
    setPrompt(drafts.get(snapshot?.serverKey + ':' + id) ?? '')
    setShareHistory(false)
    if (controls.narrow || (panel.current && panel.current.clientWidth > 0 && panel.current.clientWidth < 640)) {
      setHistoryOpen(false)
    }
  }

  return <section ref={panel} className="assistant-panel" aria-label={tr('assistant.title')}>
    <header className="assistant-header">
      <div className="assistant-heading">
        <strong>{conversation ? chatTitle(conversation) : tr('assistant.title')}</strong>
        <small title={server}>{server}{snapshot && ' · ' + tr(identity)}</small>
        {snapshot && <small>{tr(snapshot.mode === 'automatic' ? 'assistant.modeAutomatic' : 'assistant.modeManual')}</small>}
      </div>
      <div className="assistant-actions">
        <button type="button" className="icon-button" title={tr('assistant.history')} aria-label={tr('assistant.history')}
          aria-expanded={historyOpen} aria-controls={historyOpen ? historyId : undefined}
          onClick={() => setHistoryOpen((open) => !open)}><History size={16} /></button>
        <button type="button" className="icon-button" title={tr('assistant.newChat')} aria-label={tr('assistant.newChat')}
          onClick={() => { selectChat(''); composer.current?.focus() }}><Plus size={16} /></button>
        <button type="button" className="icon-button" title={tr('assistant.swap')} aria-label={tr('assistant.swap')}
          onClick={controls.swap}><ArrowLeftRight size={16} /></button>
        {!controls.narrow && <button type="button" className="icon-button"
          title={tr(controls.expanded ? 'assistant.restore' : 'assistant.maximize')}
          aria-label={tr(controls.expanded ? 'assistant.restore' : 'assistant.maximize')} onClick={controls.expand}>
          {controls.expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>}
        <button type="button" className="icon-button" title={tr(controls.narrow ? 'assistant.backToFiles' : 'common.close')}
          aria-label={tr(controls.narrow ? 'assistant.backToFiles' : 'common.close')} onClick={onClose}><X size={16} /></button>
      </div>
    </header>
    {(loadError || historyIssues.length > 0) && <div className="assistant-history-issue confirmation-error" role="alert">
      {loadError || [tr('assistant.historyPartial'), ...historyIssues].join(' ')}
      <button type="button" className="text-button" onClick={retryHistory}>{tr('assistant.retry')}</button>
    </div>}
    {snapshot?.cleanupWarning && <div className="assistant-history-issue confirmation-error" role="alert">{snapshot.cleanupWarning}</div>}
    <div className="assistant-panel-body">
      {historyOpen && <AssistantHistory id={historyId} sessionId={sessionId} snapshot={snapshot} selectedId={conversationId}
        loading={!snapshot && !loadError} onSelect={selectChat} onClose={() => setHistoryOpen(false)} />}
      <div className="assistant-chat">
        <div className="assistant-transcript" ref={transcript} aria-label={tr('assistant.chat')} tabIndex={0}>
          <div className="assistant-transcript-content" ref={transcriptContent}>
            {providers?.length === 0 ? <p>{tr('assistant.noProvider')}</p> : !conversation && <div className="assistant-empty">
              <strong>{tr('assistant.noMessages')}</strong>
              <div className="assistant-actions">
                {(['examplePort', 'exampleDocker', 'exampleLogs'] as const).map((key) =>
                  <button type="button" className="text-button" key={key} onClick={() => {
                    changePrompt(tr(`assistant.${key}`))
                    composer.current?.focus()
                  }}>{tr(`assistant.${key}`)}</button>)}
              </div>
            </div>}
            {conversation?.turns.map((turn) => <article key={turn.id} className="assistant-turn">
              <p className="assistant-user-message">{turn.prompt}</p>
              <small className="assistant-turn-status">{turn.model} · {tr(`assistant.${turn.status}`)} · {tr(turn.mode === 'automatic' ? 'assistant.modeAutomatic' : 'assistant.modeManual')}</small>
              {turn.activity.map((activity, index) => {
                if (activity.kind === 'text') return <AssistantMarkdown key={index} text={activity.text} onOpenExternalLink={onOpenExternalLink} />
                if (activity.kind === 'supplement') {
                  const item = turn.supplements.find(({ id }) => id === activity.id)
                  return item && <p key={item.id} className="assistant-user-message">{item.text}<br />
                    <small>{tr(`assistant.${item.status}`)}</small>
                  </p>
                }
                const item = turn.tools.find(({ id }) => id === activity.id)
                return item && <AssistantExecution key={item.id} sessionId={sessionId} turn={turn} record={item}
                  owned={running?.sessionId === sessionId && running.taskId === turn.id} />
              })}
              {running?.sessionId === sessionId && running.taskId === turn.id && turn.questions.filter((item) => !item.executionId)
                .map((question) => <AssistantAnswer key={question.id} sessionId={sessionId} taskId={turn.id} question={question} />)}
              {turn.error && <div role="alert" className="confirmation-error">{turn.error}</div>}
            </article>)}
          </div>
        </div>
        <form onSubmit={submit} className="assistant-composer">
          {error && <div role="alert" className="confirmation-error">{error}</div>}
          {sharing && <label className="assistant-check"><input type="checkbox" checked={shareHistory}
            onChange={(event) => setShareHistory(event.target.checked)} />{tr('assistant.share')}</label>}
          <div className="assistant-context" title={tr('assistant.privacy')}>
            <code title={directory}>{directory}</code>
            {selectedPaths.length > 0 && <span title={selectedPaths.join('\n')}>{tr('assistant.selected', { count: selectedPaths.length })}</span>}
          </div>
          <textarea ref={composer} aria-label={tr('assistant.prompt')} placeholder={tr('assistant.prompt')} value={prompt} maxLength={16000}
            onChange={(event) => changePrompt(event.target.value)} onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
            }} />
          <div className="assistant-composer-bar">
            <select aria-label={tr('assistant.modelsLabel')} title={tr('assistant.privacy')} value={providerId && model ? JSON.stringify([providerId, model]) : ''}
              disabled={!!running || busy || !providers?.length} onChange={(event) => {
                const [nextProvider, nextModel] = JSON.parse(event.target.value) as [string, string]
                setProviderId(nextProvider)
                setModel(nextModel)
                setShareHistory(false)
              }}>
              {!providers?.length && <option value="">{tr('assistant.modelsLabel')}</option>}
              {providers?.map((item) => <optgroup key={item.id} label={item.name}>
                {item.models.map((value) => <option key={value} value={JSON.stringify([item.id, value])}>{item.name} · {value}</option>)}
              </optgroup>)}
            </select>
            <select aria-label={tr('assistant.mode')} title={tr('assistant.modeNextTurn')} disabled={!snapshot || busy}
              value={snapshot?.mode ?? 'manual'} onChange={(event) => {
                const mode = event.target.value === 'automatic' ? 'automatic' : 'manual'
                if (mode === 'automatic' && !window.confirm(tr('assistant.enableAutomatic', { server, identity: tr(identity) }))) return
                void run(async () => {
                  await window.remoteFiles.assistant({ action: 'mode', input: { sessionId, mode } })
                  setSnapshot((current) => current && { ...current, mode })
                })
              }}>
              <option value="manual">{tr('assistant.modeManual')}</option>
              <option value="automatic">{tr('assistant.modeAutomatic')}</option>
            </select>
            {running?.sessionId === sessionId && <button type="button" className="text-button"
              onClick={() => void window.remoteFiles.assistant({ action: 'stop', input: { sessionId, taskId: running.taskId } })
                .catch((reason: unknown) => setError(renderMessage(messageFromUnknown(reason))))}>{tr('assistant.stop')}</button>}
            <button type="submit" className="primary-button" disabled={!snapshot || !prompt.trim() || busy
              || (running ? !canSupplement : !provider || (sharing && !shareHistory))}>{tr(canSupplement ? 'assistant.supplement' : 'assistant.send')}</button>
          </div>
        </form>
      </div>
    </div>
  </section>
}
