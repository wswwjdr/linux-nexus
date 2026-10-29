import { useEffect } from 'react'
import { CircleAlert, Info, LoaderCircle, X } from 'lucide-react'

export interface ToastNotice {
  id: number
  kind: 'error' | 'info'
  message: string
  action?: {
    label: string
    onClick: () => void
  }
}

interface GlobalToastProps {
  notice: ToastNotice | null
  onDismiss: (noticeId: number) => void
  progress?: {
    message: string
    onCancel: () => void
  } | null
}

export default function GlobalToast({ notice, onDismiss, progress }: GlobalToastProps) {
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => onDismiss(notice.id), 6000)
    return () => window.clearTimeout(timeout)
  }, [notice?.id, onDismiss])

  if (!notice && !progress) return null

  const Icon = notice?.kind === 'error' ? CircleAlert : Info

  return (
    <div className="global-toast-stack">
      {progress && (
        <div className="global-toast info" role="status">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          <span className="global-toast-message">{progress.message}</span>
          <button type="button" className="secondary-button" onClick={progress.onCancel}>取消操作</button>
        </div>
      )}
      {notice && (
        <div className={`global-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <Icon size={17} aria-hidden="true" />
          <span className="global-toast-message">{notice.message}</span>
          {notice.action && (
            <button
              className="icon-button global-toast-action"
              title={notice.action.label}
              aria-label={notice.action.label}
              onClick={() => {
                onDismiss(notice.id)
                notice.action?.onClick()
              }}
            >
              <CircleAlert size={15} />
            </button>
          )}
          <button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={() => onDismiss(notice.id)}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
