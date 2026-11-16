import { type MessageValue, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useId, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle, Trash2, X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface ConfirmationDialogProps {
  eyebrow?: string
  title: string
  description: string
  details?: { label: string; value: string }[]
  tone: 'danger' | 'warning'
  confirmLabel: string
  confirmDisabled?: boolean
  focusCancel?: boolean
  children?: ReactNode
  busyLabel?: string
  cancelLabel?: string
  error?: MessageValue | null
  errorLabel?: string
  busy?: boolean
  allowBusyCancel?: boolean
  secondaryActionLabel?: string
  onConfirm: () => void
  onSecondaryAction?: () => void
  onCancel: () => void
  onDismiss?: () => void
  priority?: boolean
}

/** Renders a confirmation portal using the supplied copy, action handlers and busy-state controls. */
export default function ConfirmationDialog({
  eyebrow,
  title,
  description,
  details = [],
  tone,
  confirmLabel,
  confirmDisabled = false,
  focusCancel = false,
  children,
  busyLabel = tr('common.processing'),
  cancelLabel = tr('common.cancel'),
  error,
  errorLabel = tr('common.operationFailed'),
  busy = false,
  allowBusyCancel = false,
  secondaryActionLabel,
  onConfirm,
  onSecondaryAction,
  onCancel,
  onDismiss = onCancel,
  priority = false,
}: ConfirmationDialogProps) {
  useLanguage()
  const id = useId()
  const Icon = tone === 'danger' ? Trash2 : AlertTriangle
  const canCancel = !busy || allowBusyCancel

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (canCancel) onDismiss()
    }

    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [canCancel, onDismiss])

  return createPortal((
    <div className={'modal-backdrop confirmation-backdrop' + (priority ? ' confirmation-backdrop-priority' : '')} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onDismiss()}>
      <section className="modal confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={id + '-description'}>
        <div className="confirmation-heading">
          <div className={'confirmation-icon ' + tone}><Icon size={19} /></div>
          <div className="confirmation-title-group">
            {eyebrow && <div className={'modal-kicker ' + tone}>{eyebrow}</div>}
            <h2 id={id + '-title'}>{title}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} disabled={!canCancel} onClick={onDismiss}><X size={18} /></button>
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
        {children}
        {error && <div className="confirmation-error" role="alert">{errorLabel}：{renderMessage(error)}</div>}
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus={focusCancel && !busy} disabled={!canCancel} onClick={onCancel}>{cancelLabel}</button>
          {secondaryActionLabel && <button type="button" className="secondary-button" disabled={busy} onClick={onSecondaryAction}>{secondaryActionLabel}</button>}
          <button type="button" className={tone === 'danger' ? 'danger-button' : 'warning-button'} autoFocus={!busy && !confirmDisabled && !focusCancel} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Icon size={15} />}
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}
