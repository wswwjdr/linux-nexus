import { useEffect, useId, useState } from 'react'
import { AlertTriangle, File, Folder, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteArchiveDecision, RemoteMoveDecision } from '@shared/types'

export type RemoteConflictDecision = RemoteMoveDecision | RemoteArchiveDecision

export interface RemoteConflictDialogAction {
  decision: RemoteConflictDecision
  label: string
  tone?: 'danger' | 'warning'
}

export interface RemoteConflictDialogChoice {
  decision: 'replace' | 'skip' | 'rename'
  label: string
}

export function RemoteConflictDialog({
  heading,
  title,
  sourceLabel,
  sourcePath,
  targetPath,
  sourceType,
  targetType,
  description,
  actions,
  choices,
  defaultChoice = 'replace',
  applyToAllLabel,
  onConfirmChoice,
  busy,
  onDecision,
}: {
  heading: string
  title: string
  sourceLabel: string
  sourcePath: string
  targetPath: string
  sourceType: 'file' | 'directory'
  targetType: 'file' | 'directory' | 'symlink' | 'other'
  description: string
  actions: RemoteConflictDialogAction[]
  choices?: RemoteConflictDialogChoice[]
  defaultChoice?: RemoteConflictDialogChoice['decision']
  applyToAllLabel?: string
  onConfirmChoice?: (decision: RemoteConflictDialogChoice['decision'], applyToAll: boolean) => void
  busy: boolean
  onDecision: (decision: RemoteConflictDecision) => void
}) {
  const titleId = useId()
  const TargetIcon = targetType === 'directory' ? Folder : File
  const [selectedChoice, setSelectedChoice] = useState<RemoteConflictDialogChoice['decision']>(defaultChoice)
  const [applyToAll, setApplyToAll] = useState(false)

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busy) onDecision('cancel')
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [busy, onDecision])

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop remote-move-backdrop" role="presentation">
      <section className="modal remote-move-conflict" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">{heading}</div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button className="icon-button modal-close" title="取消操作" aria-label="取消操作" disabled={busy} onClick={() => onDecision('cancel')}><X size={18} /></button>
        </div>
        <dl className="confirmation-details">
          <div className="confirmation-detail">
            <dt>{sourceLabel}</dt>
            <dd><span className="remote-move-item-icon">{sourceType === 'directory' ? <Folder size={15} /> : <File size={14} />}</span>{sourcePath}</dd>
          </div>
          <div className="confirmation-detail">
            <dt>目标</dt>
            <dd><span className="remote-move-item-icon"><TargetIcon size={15} /></span>{targetPath}</dd>
          </div>
        </dl>
        <p className="confirmation-description">{description}</p>
        {choices ? (
          <form className="remote-conflict-choice-form" onSubmit={(event) => {
            event.preventDefault()
            onConfirmChoice?.(selectedChoice, applyToAll)
          }}>
            <fieldset className="remote-conflict-choice-list" disabled={busy}>
              <legend>选择处理方式</legend>
              {choices.map((choice) => (
                <label className="remote-conflict-choice" key={choice.decision}>
                  <input
                    type="radio"
                    name={titleId + '-choice'}
                    value={choice.decision}
                    checked={selectedChoice === choice.decision}
                    onChange={() => setSelectedChoice(choice.decision)}
                  />
                  {choice.label}
                </label>
              ))}
            </fieldset>
            <label className="remote-conflict-apply-all">
              <input type="checkbox" checked={applyToAll} disabled={busy} onChange={(event) => setApplyToAll(event.currentTarget.checked)} />
              {applyToAllLabel}
            </label>
            <div className="remote-conflict-choice-footer">
              <button type="submit" className="primary-button" disabled={busy}>确定</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision('cancel')}>取消解压</button>
            </div>
          </form>
        ) : (
          <div className="remote-move-conflict-actions">
            {actions.map((action) => (
              <button
                key={action.decision}
                type="button"
                className={(action.tone === 'danger' ? 'danger-button' : action.tone === 'warning' ? 'warning-button' : 'secondary-button')
                  + (action.decision === 'cancel' ? ' remote-move-cancel' : '')}
                disabled={busy}
                onClick={() => onDecision(action.decision)}
              >
                {action.tone === 'danger' && (busy ? <LoaderCircle className="spin" size={15} /> : <AlertTriangle size={15} />)}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  ), document.body)
}
