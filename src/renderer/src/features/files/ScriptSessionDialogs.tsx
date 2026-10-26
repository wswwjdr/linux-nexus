import { useEffect, type FormEvent } from 'react'
import { Terminal, X } from 'lucide-react'
import type { ScriptExecutionDialogState } from '@/app-types'
import ScriptExecutionDialog from '@/components/ScriptExecutionDialog'

interface ScriptSessionDialogsProps {
  sessionId: string
  active: boolean
  commandDialog: { name: string; command: string } | null
  executionDialog: ScriptExecutionDialogState | null
  onCloseCommand: () => void
  onUpdateCommand: (command: string) => void
  onSubmitCommand: (event: FormEvent<HTMLFormElement>) => void
  onCloseExecution: () => void
  onStopExecution: () => void
}

export default function ScriptSessionDialogs({
  sessionId,
  active,
  commandDialog,
  executionDialog,
  onCloseCommand,
  onUpdateCommand,
  onSubmitCommand,
  onCloseExecution,
  onStopExecution,
}: ScriptSessionDialogsProps) {
  useEffect(() => {
    if (!active || !commandDialog) return
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCloseCommand()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [active, commandDialog, onCloseCommand])

  return (
    <>
      {commandDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCloseCommand()}>
          <section className="modal script-command-modal" role="dialog" aria-labelledby={`script-command-title-${sessionId}`}>
            <div className="modal-heading">
              <div>
                <h2 id={`script-command-title-${sessionId}`}>调整并执行</h2>
                <div className="script-command-file">{commandDialog.name}</div>
              </div>
              <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onCloseCommand}><X size={18} /></button>
            </div>
            <form onSubmit={onSubmitCommand}>
              <label className="field">
                <span>命令</span>
                <textarea autoFocus required maxLength={65535} rows={5} spellCheck={false} value={commandDialog.command} onChange={(event) => onUpdateCommand(event.target.value)} />
              </label>
              <div className="modal-footer">
                <button type="button" className="secondary-button" onClick={onCloseCommand}>取消</button>
                <button type="submit" className="primary-button" disabled={!commandDialog.command.trim()}><Terminal size={15} /> 执行</button>
              </div>
            </form>
          </section>
        </div>
      )}
      {executionDialog && (
        <ScriptExecutionDialog
          active={active}
          execution={executionDialog}
          onClose={onCloseExecution}
          onStop={onStopExecution}
        />
      )}
    </>
  )
}
