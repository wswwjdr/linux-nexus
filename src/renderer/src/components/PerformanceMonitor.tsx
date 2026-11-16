import { useCallback, useEffect, useRef } from 'react'
import { Gauge, RefreshCw, X } from 'lucide-react'
import { tr } from '@shared/i18n/messages'
import type { PerformanceMonitorState, PerformanceThresholds } from '@shared/types'
import { PerformanceOverview } from '@/features/performance/PerformanceOverview'
import { PerformanceResources } from '@/features/performance/PerformanceResources'
import { MetricNotice } from '@/features/performance/PerformanceReadings'
import { current, percent, sampleTime, severity, uptime } from '@/features/performance/presentation'
import { useLanguage } from '@/i18n'

interface PerformanceMonitorProps {
  state: PerformanceMonitorState | null
  thresholds: PerformanceThresholds
  open: boolean
  onOpenChange: (open: boolean) => void
  onEnabledChange: (enabled: boolean) => void
  onRefresh: () => void
}

/**
 * Connects the toolbar trigger and dashboard to the active monitoring session.
 * @param props Session state, thresholds and panel and sampling actions.
 * @returns Toolbar summary and, when open, the monitoring dashboard.
 */
export default function PerformanceMonitor({ state, thresholds, open, onOpenChange, onEnabledChange, onRefresh }: PerformanceMonitorProps) {
  useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const summaryRef = useRef<HTMLButtonElement>(null)
  const switchRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const enabled = state?.enabled ?? false
  const metrics = state?.metrics ?? {}
  const cpu = current(metrics.cpu)
  const memory = current(metrics.memory)
  const root = current(metrics.mounts)?.find((mount) => mount.target === '/')
  const load = current(metrics.load)
  const uptimeSeconds = current(metrics.uptime)
  const statuses = [
    severity(cpu?.percent, thresholds.cpu), severity(memory?.percent, thresholds.memory),
    severity(root?.percent, thresholds.disk), severity(cpu?.logical.length && load ? load[0] / cpu.logical.length : null, thresholds.loadPerCore),
  ]
  const level = enabled ? (['critical', 'warning', 'normal'] as const).find((status) => statuses.includes(status)) ?? 'unavailable' : 'unavailable'
  const samples = Object.values(metrics)
  const latestAt = Math.max(0, ...samples.map((metric) => metric.error ? 0 : metric.latest?.sampledAt ?? 0))
  const hasErrors = samples.some((metric) => metric.error)
  let statusText: string
  if (!state) statusText = tr('performance.waiting')
  else if (!enabled) statusText = tr('performance.off')
  else if (state.sampling) statusText = tr('common.readingServerMetrics')
  else if (hasErrors) statusText = tr(latestAt ? 'performance.partialFailure' : 'common.samplingFailedRetryingAutomatically')
  else statusText = tr(latestAt ? 'performance.live' : 'performance.waiting')
  const summaryLabel = level === 'critical' ? tr('common.serverPerformanceMetricsAreCriticallyHigh')
    : level === 'warning' ? tr('common.serverPerformanceMetricsAreElevated') : statusText

  /**
   * Closes the dashboard and restores focus to its toolbar entry.
   */
  const close = useCallback(() => {
    onOpenChange(false)
    summaryRef.current?.focus()
  }, [onOpenChange])

  useEffect(() => {
    if (!open) return
    const focusTarget = switchRef.current?.disabled ? closeRef.current : switchRef.current
    focusTarget?.focus()

    /**
     * Dismisses the panel when the pointer acts outside it.
     * @param event Pointer press from the workspace.
     */
    function dismissOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }

    /**
     * Dismisses the panel with Escape and restores toolbar focus.
     * @param event Keyboard event dispatched inside the window.
     */
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }

    /**
     * Keeps the workspace still when the wheel is used outside the monitor.
     * @param event Wheel event dispatched inside the document.
     */
    function blockBackgroundWheel(event: WheelEvent) {
      if (rootRef.current?.contains(event.target as Node)) return
      event.preventDefault()
      event.stopPropagation()
    }

    document.addEventListener('pointerdown', dismissOutside, true)
    document.addEventListener('wheel', blockBackgroundWheel, { capture: true, passive: false })
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      document.removeEventListener('wheel', blockBackgroundWheel, true)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open, onOpenChange, close])

  return <div className="performance-monitor" ref={rootRef}>
    <button ref={summaryRef} type="button" className={`performance-summary-button ${level}`}
      aria-label={tr('common.cpuMemoryDisk', { summaryLabel, value2: percent(cpu?.percent), value3: percent(memory?.percent), value4: percent(root?.percent) })}
      aria-expanded={open} aria-haspopup="dialog" title={summaryLabel} onClick={() => onOpenChange(!open)}>
      <Gauge size={15} aria-hidden="true" />
      <span className="performance-summary-item"><small>CPU</small>{percent(cpu?.percent)}</span>
      <span className="performance-summary-item"><small>{tr('common.memory')}</small>{percent(memory?.percent)}</span>
      <span className="performance-summary-item"><small>{tr('common.disk')}</small>{percent(root?.percent)}</span>
    </button>
    {open && <section className="performance-popover" role="dialog" aria-label={tr('common.serverPerformanceMonitoring')}>
      <header className="performance-popover-header">
        <div className="performance-title">
          <span className="performance-title-icon"><Gauge size={22} aria-hidden="true" /></span>
          <div>
            <h2>{tr('common.serverPerformance')}</h2>
            <div className="performance-meta">
              <span className={`performance-status ${hasErrors && enabled ? 'warning' : enabled && latestAt ? 'live' : ''}`}>{statusText}</span>
              {enabled && !!latestAt && <span>{tr('common.lastUpdated', { value1: sampleTime(latestAt) })}</span>}
              {enabled && uptimeSeconds !== undefined && <span>{tr('common.uptime')} <strong>{uptime(uptimeSeconds)}</strong></span>}
            </div>
          </div>
        </div>
        <div className="performance-popover-actions">
          <label className="performance-switch">
            <input ref={switchRef} type="checkbox" role="switch" checked={enabled} disabled={!state}
              onChange={(event) => onEnabledChange(event.currentTarget.checked)} />
            {tr('performance.monitorSwitch')}
          </label>
          <button type="button" className="icon-button subtle" title={tr('common.refreshNow')} aria-label={tr('common.refreshPerformanceMetricsNow')}
            disabled={!enabled} onClick={onRefresh}>
            <RefreshCw className={state?.sampling ? 'spin' : ''} size={16} aria-hidden="true" />
          </button>
          <button ref={closeRef} type="button" className="icon-button subtle" title={tr('performance.closePanel')}
            aria-label={tr('performance.closePanel')} onClick={close}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="performance-body">
        {enabled ? <>
          {metrics.uptime?.error && <MetricNotice metric={metrics.uptime} />}
          <PerformanceOverview metrics={metrics} thresholds={thresholds} />
          <PerformanceResources metrics={metrics} thresholds={thresholds} />
        </> : <div className="performance-empty">
          <Gauge size={28} aria-hidden="true" />
          <p>{tr(state ? 'performance.enableHint' : 'performance.waiting')}</p>
        </div>}
      </div>
    </section>}
  </div>
}
