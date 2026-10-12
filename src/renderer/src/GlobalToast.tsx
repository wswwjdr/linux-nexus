import { useEffect } from 'react'
import { CircleAlert, Info, X } from 'lucide-react'

export interface ToastNotice {
  id: number
  kind: 'error' | 'info'
  message: string
}

interface GlobalToastProps {
  notice: ToastNotice | null
  onDismiss: () => void
}

export default function GlobalToast({ notice, onDismiss }: GlobalToastProps) {
  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(onDismiss, 6000)
    return () => window.clearTimeout(timeout)
  }, [notice?.id, onDismiss])

  if (!notice) return null

  const Icon = notice.kind === 'error' ? CircleAlert : Info

  return (
    <div className={`global-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <Icon size={17} aria-hidden="true" />
      <span className="global-toast-message">{notice.message}</span>
      <button className="icon-button" title="关闭提示" aria-label="关闭提示" onClick={onDismiss}>
        <X size={15} />
      </button>
    </div>
  )
}
