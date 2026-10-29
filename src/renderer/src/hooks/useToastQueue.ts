import { useCallback, useRef, useState } from 'react'
import type { ToastNotice } from '../GlobalToast'

export function useToastQueue() {
  const [queue, setQueue] = useState<ToastNotice[]>([])
  const sequence = useRef(0)

  const showToast = useCallback((kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => {
    const notice: ToastNotice = { id: ++sequence.current, kind, message, action }
    setQueue((current) => [...current, notice])
  }, [])

  const dismissToast = useCallback((noticeId: number) => {
    setQueue((current) => current[0]?.id === noticeId ? current.slice(1) : current)
  }, [])

  return { toast: queue[0] ?? null, showToast, dismissToast }
}
