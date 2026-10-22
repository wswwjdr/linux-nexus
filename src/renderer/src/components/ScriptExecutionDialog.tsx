import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleX, LoaderCircle, Square, X } from 'lucide-react'
import type { ScriptExecutionDialogState } from '@/app-types'

interface ScriptExecutionDialogProps {
  execution: ScriptExecutionDialogState
  onClose: () => void
  onStop: () => void
}

const statusLabels: Record<ScriptExecutionDialogState['status'], string> = {
  starting: '正在启动',
  running: '运行中',
  cancelling: '正在停止',
  completed: '已完成',
  cancelled: '已停止',
  failed: '执行失败',
}

export default function ScriptExecutionDialog({ execution, onClose, onStop }: ScriptExecutionDialogProps) {
  const outputRef = useRef<HTMLPreElement>(null)
  const onCloseRef = useRef(onClose)
  const followOutputRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const isRunning = execution.status === 'starting' || execution.status === 'running' || execution.status === 'cancelling'
  onCloseRef.current = onClose

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseRef.current()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [])

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
      <section className="modal script-execution-modal" role="dialog" aria-modal="true" aria-labelledby="script-execution-title">
        <div className="modal-heading">
          <div className="script-execution-heading-copy">
            <h2 id="script-execution-title">{execution.name}</h2>
            <div className="script-command-file" title={execution.request.scriptPath}>{execution.request.scriptPath}</div>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭执行窗口" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="script-execution-command">
          <span>命令</span>
          <code>{execution.request.command}</code>
        </div>

        <div className={'script-execution-status ' + execution.status} role="status">
          {isRunning ? <LoaderCircle className="spin" size={15} /> : execution.status === 'completed' ? <CheckCircle2 size={15} /> : <CircleX size={15} />}
          <span>{statusLabels[execution.status]}</span>
          {execution.message && <span className="script-execution-message">{execution.message}</span>}
        </div>

        <pre
          ref={outputRef}
          className="script-execution-output"
          aria-label="脚本输出"
          onScroll={updateFollowState}
        >{execution.output.length
          ? execution.output.map((chunk, index) => <span className={chunk.stream === 'stderr' ? 'stderr' : undefined} key={index}>{chunk.data}</span>)
          : <span className="script-execution-empty">等待脚本输出…</span>}</pre>

        <div className="modal-footer script-execution-footer">
          {isRunning && (
            <button type="button" className="danger-button" disabled={execution.status === 'cancelling'} onClick={onStop}>
              <Square size={14} /> 停止执行
            </button>
          )}
          {!atBottom && <span className="script-output-follow-hint">输出已暂停跟随</span>}
          <button type="button" className="secondary-button" onClick={onClose}>{isRunning ? '关闭并停止' : '关闭'}</button>
        </div>
      </section>
    </div>
  )
}
