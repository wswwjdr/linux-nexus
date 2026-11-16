import { msg } from '@shared/i18n/messages'
import type { PerformanceMonitorState } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

type Notify = (kind: ToastNotice['kind'], message: ToastNotice['message']) => void

/** Connects the active SSH tab to the monitor service and exposes its current state and controls. */
export function usePerformanceMonitoring(connectedSessionId: string | null, showToast: Notify) {
  const [state, setState] = useState<PerformanceMonitorState | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  /** Accepts only monitor states at least as recent as the current renderer state. */
  const accept = useCallback((next: PerformanceMonitorState) => {
    setState((current) => !current || next.version > current.version ? next : current)
  }, [])

  useEffect(() => window.remoteFiles.onPerformanceUpdate(accept), [accept])

  useEffect(() => {
    setOpenSessionId(null)
    let active = true
    void window.remoteFiles.focusPerformanceMonitor(connectedSessionId).then(accept).catch((error: unknown) => {
      if (active) showToast('error', msg('performance.focusFailed', { detail: errorMessage(error) }))
    })
    return () => { active = false }
  }, [accept, connectedSessionId, showToast])

  /** Opens or closes the panel for the currently connected tab. */
  const setPanelOpen = useCallback((open: boolean) => {
    setOpenSessionId(open ? connectedSessionId : null)
  }, [connectedSessionId])

  /** Sets the active tab's monitoring switch to enabled. */
  const setEnabled = useCallback((enabled: boolean) => {
    if (!connectedSessionId) return
    void window.remoteFiles.setPerformanceMonitorEnabled(connectedSessionId, enabled).then(accept).catch((error: unknown) => {
      showToast('error', msg('performance.switchFailed', { detail: errorMessage(error) }))
    })
  }, [accept, connectedSessionId, showToast])

  /** Requests fresh readings for the active tab. */
  const refresh = useCallback(() => {
    if (!connectedSessionId) return
    void window.remoteFiles.refreshPerformanceMonitor(connectedSessionId).catch((error: unknown) => {
      showToast('error', msg('common.couldNotRefreshPerformanceMonitoring', { value1: errorMessage(error) }))
    })
  }, [connectedSessionId, showToast])

  return {
    state: state?.sessionId === connectedSessionId ? state : null,
    panelOpen: connectedSessionId !== null && openSessionId === connectedSessionId,
    setPanelOpen,
    setEnabled,
    refresh,
  }
}
