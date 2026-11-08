import { type MessageValue, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleX, LoaderCircle, Square, X } from 'lucide-react'
import type { ScriptExecutionDialogState } from '@/app-types'

interface ScriptExecutionDialogProps {
  active: boolean
  execution: ScriptExecutionDialogState
  onClose: () => void
  onStop: () => void
}

const statusLabels: Record<ScriptExecutionDialogState['status'], MessageValue> = {
  starting: msg('common.starting'),
  running: msg('common.running'),
  cancelling: msg('common.stopping'),
  completed: msg('common.completed'),
  cancelled: msg('common.stopped'),
  failed: msg('common.executionFailed'),
}

export default function ScriptExecutionDialog({ active, execution, onClose, onStop }: ScriptExecutionDialogProps) {
  useLanguage()
  const outputRef = useRef<HTMLPreElement>(null)
  const onCloseRef = useRef(onClose)
  const followOutputRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const isRunning = execution.status === 'starting' || execution.status === 'running' || execution.status === 'cancelling'
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [active])

  useEffect(() => {
    if (!followOutputRef.current || !outputRef.current) return
    outputRef.current.scrollTop = outputRef.current.scrollHeight
  }, [execution.output])

  const updateFollowState = () => {
    const element = outputRef.current
    if (!element) return
    const nextAtBottom = element.scrollHeight - element.clientHeight - element.scrollTop < 12
    followOutputRef.current = nextAtBottom
    setAtBottom(nextAtBottom)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal script-execution-modal" role="dialog" aria-labelledby={`script-execution-title-${execution.request.sessionId}`}>
        <div className="modal-heading">
          <div className="script-execution-heading-copy">
            <h2 id={`script-execution-title-${execution.request.sessionId}`}>{execution.name}</h2>
            <div className="script-command-file" title={execution.request.scriptPath}>{execution.request.scriptPath}</div>
          </div>
          <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.closeExecutionWindow')} onClick={onClose}><X size={18} /></button>
        </div>

        <div className="script-execution-command">
          <span>{tr('common.command')}</span>
          <code>{execution.request.command}</code>
        </div>

        <div className={'script-execution-status ' + execution.status} role="status">
          {isRunning ? <LoaderCircle className="spin" size={15} /> : execution.status === 'completed' ? <CheckCircle2 size={15} /> : <CircleX size={15} />}
          <span>{renderMessage(statusLabels[execution.status])}</span>
          {execution.message && <span className="script-execution-message">{renderMessage(execution.message)}</span>}
        </div>

        <pre
          ref={outputRef}
          className="script-execution-output"
          aria-label={tr('common.scriptOutput')}
          onScroll={updateFollowState}
        >{execution.output.length
          ? execution.output.map((chunk, index) => <span className={chunk.stream === 'stderr' ? 'stderr' : undefined} key={index}>{chunk.data}</span>)
          : <span className="script-execution-empty">{isRunning ? tr('common.waitingForScriptOutput') : tr('common.scriptProducedNoOutput')}</span>}</pre>

        <div className="modal-footer script-execution-footer">
          {isRunning && (
            <button type="button" className="danger-button" disabled={execution.status === 'cancelling'} onClick={onStop}>
              <Square size={14} />{tr('common.stopExecution')}</button>
          )}
          {!atBottom && <span className="script-output-follow-hint">{tr('common.outputAutoScrollPaused')}</span>}
          <button type="button" className="secondary-button" onClick={onClose}>{isRunning ? tr('common.closeAndStop') : tr('common.close')}</button>
        </div>
      </section>
    </div>
  )
}
