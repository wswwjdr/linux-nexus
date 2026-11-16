import { msg } from '@shared/i18n/messages'
import type { PerformanceMonitorState } from '@shared/types'
import { useCallback, useEffect, useState } from 'react'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

type Notify = (kind: ToastNotice['kind'], message: ToastNotice['message']) => void

/**
 * Exposes the current server's shared monitoring state and panel controls.
 * @param profileId Configuration ID of the selected connected server, or null.
 * @param showToast Displays monitor request errors.
 * @returns The active snapshot, panel visibility, and monitor actions.
 */
export function usePerformanceMonitoring(profileId: string | null, showToast: Notify) {
  const [states, setStates] = useState(() => new Map<string, PerformanceMonitorState>())
  const [openProfileId, setOpenProfileId] = useState<string | null>(null)

  /**
   * Updates one cached snapshot without allowing a delayed response to overwrite it.
   * @param next Server snapshot from the IPC response or update event.
   */
  const accept = useCallback((next: PerformanceMonitorState) => {
    setStates((current) => {
      const previous = current.get(next.profileId)
      if (previous && previous.version >= next.version) return current
      return new Map(current).set(next.profileId, next)
    })
  }, [])

  useEffect(() => window.remoteFiles.onPerformanceUpdate(accept), [accept])

  useEffect(() => {
    setOpenProfileId(null)
  }, [profileId])

  useEffect(() => {
    if (!profileId) return
    let active = true
    void window.remoteFiles.getPerformanceMonitorState(profileId).then(accept).catch((error: unknown) => {
      if (active) showToast('error', msg('performance.snapshotFailed', { detail: errorMessage(error) }))
    })
    return () => { active = false }
  }, [accept, profileId, showToast])

  /**
   * Changes the current server's panel visibility.
   * @param open Whether to show the panel.
   */
  const setPanelOpen = useCallback((open: boolean) => {
    setOpenProfileId(open ? profileId : null)
  }, [profileId])

  /**
   * Sets the current server's shared monitoring switch.
   * @param enabled Desired switch value.
   */
  const setEnabled = useCallback((enabled: boolean) => {
    if (!profileId) return
    void window.remoteFiles.setPerformanceMonitorEnabled(profileId, enabled).then(accept).catch((error: unknown) => {
      showToast('error', msg('performance.switchFailed', { detail: errorMessage(error) }))
    })
  }, [accept, profileId, showToast])

  /** Requests fresh readings for the current server. */
  const refresh = useCallback(() => {
    if (!profileId) return
    void window.remoteFiles.refreshPerformanceMonitor(profileId).catch((error: unknown) => {
      showToast('error', msg('common.couldNotRefreshPerformanceMonitoring', { value1: errorMessage(error) }))
    })
  }, [profileId, showToast])

  return {
    state: profileId ? states.get(profileId) ?? null : null,
    panelOpen: profileId !== null && openProfileId === profileId,
    setPanelOpen,
    setEnabled,
    refresh,
  }
}
