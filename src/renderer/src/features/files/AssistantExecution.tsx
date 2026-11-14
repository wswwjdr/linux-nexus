import { useState, type FormEvent } from 'react'
import { messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { AssistantOutput, AssistantQuestion, AssistantToolRecord, AssistantTurn } from '@shared/types/assistant'

/** Renders a single task question and sends its answer directly through the scoped IPC channel. */
export function AssistantAnswer({ sessionId, taskId, question }: { sessionId: string; taskId: string; question: AssistantQuestion }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  /** Submits the form answer, clearing the field before IPC can retain the input. */
  async function answer(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (busy) return
    const field = event.currentTarget.elements.namedItem('answer') as HTMLInputElement
    const text = question.executionId ? field.value : field.value.trim()
    if (!text) return
    field.value = ''
    setBusy(true)
    setError('')
    try {
      await window.remoteFiles.assistant({ action: 'answer', input: { sessionId, taskId, questionId: question.id, text } })
    } catch (reason) {
      setError(renderMessage(messageFromUnknown(reason)))
    } finally {
      setBusy(false)
    }
  }

  return <form className="assistant-question" onSubmit={(event) => void answer(event)}>
    <label>{question.text}
      <input name="answer" type={question.executionId ? 'password' : 'text'} required
        autoComplete="off" maxLength={question.executionId ? 4096 : 16000} disabled={busy} />
    </label>
    <button type="submit" className="text-button" disabled={busy}>{tr('assistant.answer')}</button>
    {error && <p role="alert">{error}</p>}
  </form>
}

/** Shows the exact command, execution output and pending approvals tied to its task. */
export function AssistantExecution({ sessionId, turn, record, owned }: {
  sessionId: string; turn: AssistantTurn; record: AssistantToolRecord; owned: boolean;
}) {
  const [page, setPage] = useState<{ index: number; output: AssistantOutput[] }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const scope = { sessionId, taskId: turn.id }
  const pages = record.outputPages ?? 0
  const approvals = owned ? turn.approvals.filter(({ executionId }) => executionId === record.id) : []
  const questions = owned ? turn.questions.filter(({ executionId }) => executionId === record.id) : []

  /** Sends an approval or fetches output and reports renderer-facing IPC errors. */
  async function run(action: () => Promise<unknown>): Promise<void> {
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

  /** Loads one immutable log page for the displayed execution. */
  async function load(index: number): Promise<void> {
    setPage({ index, output: await window.remoteFiles.assistant({ action: 'output',
      input: { ...scope, executionId: record.id, page: index } }) })
  }

  return <details className="assistant-tool" open={approvals.length || questions.length ? true : undefined}>
    <summary>{record.purpose ?? record.name} · <code>{record.path}</code>
      {' · '}{tr(record.status === 'done' ? 'assistant.toolDone' : `assistant.${record.status}`)}
      {record.elapsedMs !== undefined && ` · ${(record.elapsedMs / 1000).toFixed(2)} s`}
      {record.error && <span className="assistant-tool-error">{record.error}</span>}
    </summary>
    {record.command && <pre>{record.command}</pre>}
    {record.exitCode != null && <small>{tr('assistant.exitCode', { code: record.exitCode })}</small>}
    {approvals.map((approval) => <div className="assistant-approval" key={approval.id}>
      <strong>{tr(approval.kind === 'command' ? 'assistant.approveCommand'
        : approval.kind === 'eof' ? 'assistant.approveEof' : 'assistant.approveInput')}</strong>
      {approval.kind === 'input' && <pre>{JSON.stringify(approval.text)}</pre>}
      <div className="assistant-actions">
        {[true, false].map((approved) => <button key={String(approved)} type="button" className="text-button" disabled={busy}
          onClick={() => void run(() => window.remoteFiles.assistant({ action: 'approve',
            input: { ...scope, approvalId: approval.id, approved } }))}>{tr(approved ? 'assistant.approve' : 'assistant.reject')}</button>)}
      </div>
    </div>)}
    {questions.map((question) => <AssistantAnswer key={question.id} {...scope} question={question} />)}
    {page ? <pre>{page.output.map((item, index) => <span key={index} data-stream={item.stream}>{item.text}</span>)}</pre>
      : record.output && <pre>{record.output}</pre>}
    {record.truncated && <small>{tr('assistant.outputTruncated')}</small>}
    {pages > 0 && <div className="assistant-actions">
      <button type="button" className="text-button" disabled={busy || page?.index === 0}
        onClick={() => void run(() => load(page ? page.index - 1 : 0))}>{tr(page ? 'assistant.previousOutput' : 'assistant.fullOutput')}</button>
      {page && <>
        <span>{page.index + 1} / {pages}</span>
        <button type="button" className="text-button" disabled={busy || page.index + 1 >= pages}
          onClick={() => void run(() => load(page.index + 1))}>{tr('assistant.nextOutput')}</button>
        <button type="button" className="text-button" onClick={() => setPage(undefined)}>{tr('assistant.liveOutput')}</button>
      </>}
    </div>}
    {error && <p role="alert" className="assistant-tool-error">{error}</p>}
  </details>
}
