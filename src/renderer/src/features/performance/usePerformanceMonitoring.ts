import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { PerformanceMonitorState } from '@shared/types'
import type { SessionTab } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UsePerformanceMonitoringOptions {
  connectedSessionId: string | null
  sessionsRef: MutableRefObject<SessionTab[]>
  showToast: (kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => void
}

export function usePerformanceMonitoring({ connectedSessionId, sessionsRef, showToast }: UsePerformanceMonitoringOptions) {
  const [states, setStates] = useState<Record<string, PerformanceMonitorState>>({})
  const [panelOpen, setPanelOpen] = useState(false)

  useEffect(() => window.remoteFiles.onPerformanceUpdate((event: PerformanceMonitorState) => {
    if (!sessionsRef.current.some((session) => session.id === event.sessionId)) return
    setStates((current) => {
      const previous = current[event.sessionId]
      return previous && previous.version >= event.version
        ? current
        : { ...current, [event.sessionId]: event }
    })
  }), [])

  useEffect(() => {
    setPanelOpen(false)
    if (!connectedSessionId) return
    const sessionId = connectedSessionId
    let cancelled = false
    void window.remoteFiles.activatePerformanceMonitor(sessionId)
      .then(() => window.remoteFiles.getPerformanceMonitorState(sessionId))
      .then((state) => {
        if (cancelled) return
        setStates((current) => {
          const previous = current[sessionId]
          return previous && previous.version > state.version
            ? current
            : { ...current, [sessionId]: state }
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast('error', '启动性能监控失败：' + errorMessage(error))
      })
    return () => {
      cancelled = true
      void window.remoteFiles.deactivatePerformanceMonitor(sessionId).catch((error: unknown) => {
        showToast('error', '停止性能监控失败：' + errorMessage(error))
      })
    }
  }, [connectedSessionId, showToast])

  const removeSessionStates = useCallback((sessionIds: string[]) => {
    setStates((current) => {
      const next = { ...current }
      for (const sessionId of sessionIds) delete next[sessionId]
      return next
    })
  }, [])

  const refresh = useCallback((sessionId: string) => {
    void window.remoteFiles.refreshPerformanceMonitor(sessionId).catch((error: unknown) => {
      showToast('error', '刷新性能监控失败：' + errorMessage(error))
    })
  }, [showToast])

  return { states, panelOpen, setPanelOpen, removeSessionStates, refresh }
}
