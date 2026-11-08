import { type MessageValue } from '@shared/i18n/messages'
import { useCallback, useRef, useState } from 'react'
import type { ToastNotice } from '../GlobalToast'

export function useToasts() {
  const [notices, setNotices] = useState<ToastNotice[]>([])
  const sequence = useRef(0)

  const showToast = useCallback((kind: ToastNotice['kind'], message: MessageValue, action?: ToastNotice['action']) => {
    const notice: ToastNotice = { id: ++sequence.current, kind, message, action }
    setNotices((current) => [...current, notice])
  }, [])

  const dismissToast = useCallback((noticeId: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== noticeId))
  }, [])

  return { notices, showToast, dismissToast }
}
