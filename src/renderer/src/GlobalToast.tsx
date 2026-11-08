import { type MessageValue, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useState, type CSSProperties } from 'react'
import { CircleAlert, Info, LoaderCircle, X } from 'lucide-react'

export interface ToastNotice {
  id: number
  kind: 'error' | 'info'
  message: MessageValue
  action?: {
    label: string
    onClick: () => void
  }
}

interface GlobalToastProps {
  notices: ToastNotice[]
  onDismiss: (noticeId: number) => void
  progress?: {
    message: MessageValue
    onCancel: () => void
  } | null
}

const DISPLAY_MS = 3000
const FADE_OUT_MS = 240
const fadeStyle = { '--toast-fade-duration': `${FADE_OUT_MS}ms` } as CSSProperties

function ToastMessage({ notice, onDismiss }: { notice: ToastNotice; onDismiss: GlobalToastProps['onDismiss'] }) {
  useLanguage()
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const timeout = leaving
      ? window.setTimeout(() => onDismiss(notice.id), FADE_OUT_MS)
      : window.setTimeout(() => setLeaving(true), DISPLAY_MS)
    return () => window.clearTimeout(timeout)
  }, [leaving, notice.id, onDismiss])

  const Icon = notice.kind === 'error' ? CircleAlert : Info

  return (
    <div className={`global-toast ${notice.kind}${leaving ? ' is-leaving' : ''}`} style={fadeStyle} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span className="global-toast-message">{renderMessage(notice.message)}</span>
      {notice.action && (
        <button
          className="icon-button global-toast-action"
          title={notice.action.label}
          aria-label={notice.action.label}
          disabled={leaving}
          onClick={() => {
            setLeaving(true)
            notice.action?.onClick()
          }}
        >
          <CircleAlert size={15} />
        </button>
      )}
      <button className="icon-button" title={tr('common.dismissNotification')} aria-label={tr('common.dismissNotification')} disabled={leaving} onClick={() => setLeaving(true)}>
        <X size={15} />
      </button>
    </div>
  )
}

export default function GlobalToast({ notices, onDismiss, progress }: GlobalToastProps) {
  useLanguage()
  if (notices.length === 0 && !progress) return null

  return (
    <div className="global-toast-stack">
      {progress && (
        <div className="global-toast info" role="status">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          <span className="global-toast-message">{renderMessage(progress.message)}</span>
          <button type="button" className="secondary-button" onClick={progress.onCancel}>{tr('common.cancelOperation')}</button>
        </div>
      )}
      {notices.map((notice) => <ToastMessage key={notice.id} notice={notice} onDismiss={onDismiss} />)}
    </div>
  )
}
