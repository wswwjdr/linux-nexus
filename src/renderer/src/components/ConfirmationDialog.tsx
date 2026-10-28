import { useEffect, useId } from 'react'
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface ConfirmationDialogProps {
  eyebrow?: string
  title: string
  description: string
  details?: { label: string; value: string }[]
  tone: 'danger' | 'warning'
  confirmLabel: string
  busyLabel?: string
  cancelLabel?: string
  error?: string | null
  errorLabel?: string
  busy?: boolean
  secondaryActionLabel?: string
  onConfirm: () => void
  onSecondaryAction?: () => void
  onCancel: () => void
}

export default function ConfirmationDialog({
  eyebrow,
  title,
  description,
  details = [],
  tone,
  confirmLabel,
  busyLabel = '处理中',
  cancelLabel = '取消',
  error,
  errorLabel = '操作失败',
  busy = false,
  secondaryActionLabel,
  onConfirm,
  onSecondaryAction,
  onCancel,
}: ConfirmationDialogProps) {
  const id = useId()
  const Icon = tone === 'danger' ? Trash2 : AlertTriangle

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busy) onCancel()
    }

    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [busy, onCancel])

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <section className="modal confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={id + '-description'}>
        <div className="confirmation-heading">
          <div className={'confirmation-icon ' + tone}><Icon size={19} /></div>
          <div className="confirmation-title-group">
            {eyebrow && <div className={'modal-kicker ' + tone}>{eyebrow}</div>}
            <h2 id={id + '-title'}>{title}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={busy} onClick={onCancel}><X size={18} /></button>
        </div>
        {details.length > 0 && (
          <dl className="confirmation-details">
            {details.map(({ label, value }) => (
              <div className="confirmation-detail" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p id={id + '-description'} className="confirmation-description">{description}</p>
        {error && <div className="confirmation-error" role="alert">{errorLabel}：{error}</div>}
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus={busy} disabled={busy} onClick={onCancel}>{cancelLabel}</button>
          {secondaryActionLabel && <button type="button" className="secondary-button" disabled={busy} onClick={onSecondaryAction}>{secondaryActionLabel}</button>}
          <button type="button" className={tone === 'danger' ? 'danger-button' : 'warning-button'} autoFocus={!busy} disabled={busy} onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Icon size={15} />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}
