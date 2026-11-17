import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { msg, renderMessage, tr, type MessageValue } from '@shared/i18n/messages'
import type { LocalEditTask } from '@shared/types'
import { useLanguage } from '@/i18n'
import { errorMessage } from '@/app-utils'
import type { useToasts } from '@/hooks/useToasts'

type ShowToast = ReturnType<typeof useToasts>['showToast']

/** Subscribes to task snapshots and upload results.
 * @param showToast Application notification handler.
 * @param onSaved Refreshes the directory affected by a completed upload.
 * @returns Current local editing tasks.
 */
export function useLocalEdits(showToast: ShowToast, onSaved: (sessionId: string, remotePath: string) => void): LocalEditTask[] {
  const [tasks, setTasks] = useState<LocalEditTask[]>([])
  const refreshSavedDirectory = useEffectEvent(onSaved)
  useEffect(() => {
    let current = true
    let receivedUpdate = false
    const unsubscribe = window.remoteFiles.onLocalEdits(update => {
      receivedUpdate = true
      setTasks(update.tasks)
      const outcome = update.outcome
      if (outcome?.type === 'saved') {
        showToast('info', msg('localEdit.saved'))
        refreshSavedDirectory(outcome.sessionId, outcome.remotePath)
      } else if (outcome?.type === 'failed') {
        showToast('error', outcome.error)
      }
    })
    void window.remoteFiles.listLocalEdits().then(snapshot => {
      if (current && !receivedUpdate) setTasks(snapshot)
    }).catch(error => {
      if (current) showToast('error', errorMessage(error))
    })
    return () => {
      current = false
      unsubscribe()
    }
  }, [showToast])
  return tasks
}

interface Props {
  tasks: LocalEditTask[]
  onClose: () => void
}

/** Displays local editing tasks and sends actions for their IDs.
 * @param props Current tasks and the dismissal callback.
 * @returns The editing task dialog.
 */
export default function LocalEditsDialog({ tasks, onClose }: Props) {
  useLanguage()
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [feedback, setFeedback] = useState<{ kind: 'error' | 'info'; message: MessageValue } | null>(null)
  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  /** Reports a failed local edit action inside the modal. */
  const report = (error: unknown) => setFeedback({ kind: 'error', message: errorMessage(error) })

  /** Asks the main process to confirm and upload the current revision. */
  const upload = (id: string) => {
    setFeedback(null)
    void window.remoteFiles.uploadLocalEdit(id).catch(report)
  }

  /** Restores confirmation dialogs for future changes to the task. */
  const restorePrompt = (id: string) => {
    setFeedback(null)
    void window.remoteFiles.restoreLocalEditPrompt(id).catch(report)
  }

  /** Opens a folder picker and exports a copy of a local edit. */
  const saveCopy = (id: string) => {
    setFeedback(null)
    void window.remoteFiles.exportLocalEdit(id).then(saved => {
      if (saved) setFeedback({ kind: 'info', message: msg('localEdit.exported') })
    }).catch(report)
  }

  /** Asks the main process to confirm before deleting the copy for a task. */
  const discard = (id: string) => {
    setFeedback(null)
    void window.remoteFiles.discardLocalEdit(id).catch(report)
  }

  return (
    <dialog ref={dialogRef} className="modal local-edits-dialog" aria-labelledby={titleId} onCancel={event => {
      event.preventDefault()
      onClose()
    }}>
      <header className="modal-heading">
        <h2 id={titleId}>{tr('localEdit.title')}</h2>
        <button className="icon-button modal-close" type="button" aria-label={tr('common.close')} onClick={onClose}><X size={18} /></button>
      </header>
      {feedback && <p role={feedback.kind === 'error' ? 'alert' : 'status'}>{renderMessage(feedback.message)}</p>}
      {tasks.length === 0 && <p>{tr('localEdit.empty')}</p>}
      <ul className="local-edits-list">
        {tasks.map(task => (
          <li key={task.id} aria-busy={task.busy}>
            <strong>{task.name}</strong>
            <span>{task.server} · {task.remotePath}</span>
            {(!task.conflict || task.state === 'unavailable') && <span role="status">{tr(`localEdit.${task.state}`)}</span>}
            {task.autoUpload && <span>{tr('localEdit.autoUploadEnabled')}</span>}
            {task.error && <p role="alert">{renderMessage(task.error)}</p>}
            <div className="modal-footer local-edit-actions">
              {task.autoUpload && <button type="button" className="secondary-button" disabled={task.busy} onClick={() => restorePrompt(task.id)}>{tr('localEdit.restorePrompt')}</button>}
              <button type="button" className="secondary-button" disabled={task.busy} onClick={() => discard(task.id)}>{tr('localEdit.discard')}</button>
              <button type="button" className={task.conflict ? 'primary-button' : 'secondary-button'} disabled={task.busy || task.state === 'unavailable'} onClick={() => saveCopy(task.id)}>
                {tr(task.conflict ? 'localEdit.exportChanges' : 'localEdit.export')}
              </button>
              {!task.conflict && <button type="button" className="primary-button" disabled={task.busy || task.state !== 'modified'} onClick={() => upload(task.id)}>{tr('localEdit.upload')}</button>}
            </div>
          </li>
        ))}
      </ul>
    </dialog>
  )
}
