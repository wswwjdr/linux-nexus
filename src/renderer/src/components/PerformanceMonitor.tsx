import { formatLocale, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { Gauge, RefreshCw, X } from 'lucide-react'
import type { PerformanceMonitorState, PerformanceThresholds } from '@shared/types'
import type { PerformanceSeries } from '@shared/performance'
import { performanceSeverity, performanceTrendPaths } from '@shared/performance'

interface PerformanceMonitorProps {
  state: PerformanceMonitorState | null
  thresholds: PerformanceThresholds
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh: (sessionId: string) => void
}

const WINDOW_MS = 15 * 60 * 1000

function percent(value: number | null): string {
  return value === null ? '…' : Math.round(value) + '%'
}

function formatBytes(bytes: number): string {
  const gibibytes = bytes / (1024 ** 3)
  return gibibytes >= 1 ? gibibytes.toFixed(1) + ' GiB' : (bytes / (1024 ** 2)).toFixed(0) + ' MiB'
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  return days > 0 ? tr('common.dH', { "days": days, "hours": hours }) : hours > 0 ? tr('common.hM', { "hours": hours, "minutes": minutes }) : tr('common.min', { "minutes": minutes })
}

function metricSeverity(value: number | null, warning: number, critical: number): 'normal' | 'warning' | 'critical' | 'unavailable' {
  if (value === null) return 'unavailable'
  if (value >= critical) return 'critical'
  if (value >= warning) return 'warning'
  return 'normal'
}

function MetricTrend({
  label,
  value,
  history,
  nowMs,
  warning,
  critical,
  series,
}: {
  label: string
  value: number | null
  history: PerformanceMonitorState['history']
  nowMs: number
  warning: number
  critical: number
  series: 'cpu' | 'memory' | 'disk'
}) {
  useLanguage()
  const severity = metricSeverity(value, warning, critical)
  const key: PerformanceSeries = series === 'cpu' ? 'cpuPercent' : series === 'memory' ? 'memoryPercent' : 'diskPercent'
  const paths = performanceTrendPaths(history, key, nowMs, WINDOW_MS)
  return (
    <div className={'performance-trend-row ' + severity}>
      <div className="performance-trend-heading">
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <div className="performance-trend-scale" aria-hidden="true">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <svg className={'performance-trend-chart ' + series} viewBox="0 0 600 40" preserveAspectRatio="none" role="img" aria-label={tr('common.overTheLast15MinutesVerticalAxis0100', { "label": label })}>
        <title>{tr('common.trendTitle', { label })}</title>
        <path className="performance-trend-grid" d="M0 4H600 M0 19H600 M0 34H600" />
        {paths.map((path, index) => <path className="performance-trend-line" d={path} key={index} />)}
      </svg>
    </div>
  )
}

export default function PerformanceMonitor({ state, thresholds, open, onOpenChange, onRefresh }: PerformanceMonitorProps) {
  useLanguage()
  const rootRef = useRef<HTMLDivElement>(null)
  const [nowMs, setNowMs] = useState(Date.now())
  const snapshot = state?.snapshot ?? null
  const severity = state?.status === 'error' || !snapshot
    ? 'unavailable'
    : performanceSeverity(snapshot, thresholds)
  const summaryLabel = state?.status === 'error'
    ? tr('common.performanceMetricsUnavailable')
    : severity === 'critical' ? tr('common.serverPerformanceMetricsAreCriticallyHigh')
      : severity === 'warning' ? tr('common.serverPerformanceMetricsAreElevated')
        : snapshot ? tr('common.serverPerformanceMetricsAreNormal') : tr('common.collectingServerPerformanceMetrics')

  useEffect(() => {
    if (!open) return
    setNowMs(Date.now())
    const clock = window.setInterval(() => setNowMs(Date.now()), 1_000)
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    const blockBackgroundWheel = (event: WheelEvent) => {
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
      window.clearInterval(clock)
    }
  }, [open, onOpenChange])

  const history = state?.history ?? []
  const statusText = state?.status === 'error'
    ? tr('common.samplingFailedRetryingAutomatically')
    : snapshot ? tr('common.lastUpdated', { "value1": new Date(snapshot.sampledAt).toLocaleTimeString(formatLocale()) }) : tr('common.readingServerMetrics')

  return (
    <div className="performance-monitor" ref={rootRef}>
      <button
        type="button"
        className={'performance-summary-button ' + severity}
        aria-label={tr('common.cpuMemoryDisk', { "summaryLabel": summaryLabel, "value2": percent(snapshot?.cpuPercent ?? null), "value3": percent(snapshot?.memoryPercent ?? null), "value4": percent(snapshot?.diskPercent ?? null) })}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summaryLabel}
        onClick={() => onOpenChange(!open)}
      >
        <Gauge size={15} aria-hidden="true" />
        <span className="performance-summary-item"><small>CPU</small>{percent(snapshot?.cpuPercent ?? null)}</span>
        <span className="performance-summary-item"><small>{tr('common.memory')}</small>{percent(snapshot?.memoryPercent ?? null)}</span>
        <span className="performance-summary-item"><small>{tr('common.disk')}</small>{percent(snapshot?.diskPercent ?? null)}</span>
      </button>

      {open && (
        <section className="performance-popover" role="dialog" aria-label={tr('common.serverPerformanceMonitoring')}>
          <header className="performance-popover-header">
            <div>
              <h2>{tr('common.serverPerformance')}</h2>
              <span className={'performance-status ' + severity} role="status" aria-live="off">{severity === 'normal' ? tr('common.normal') : severity === 'warning' ? tr('settings.warning') : severity === 'critical' ? tr('settings.critical') : tr('common.unavailable')} · {statusText}</span>
            </div>
            <div className="performance-popover-actions">
              <button type="button" className="icon-button subtle" title={tr('common.refreshNow')} aria-label={tr('common.refreshPerformanceMetricsNow')} disabled={!state || state.status === 'sampling'} onClick={() => state && onRefresh(state.sessionId)}>
                <RefreshCw className={state?.status === 'sampling' ? 'spin' : ''} size={15} />
              </button>
              <button type="button" className="icon-button subtle" title={tr('common.close')} aria-label={tr('common.closePerformanceMonitoring')} onClick={() => onOpenChange(false)}><X size={15} /></button>
            </div>
          </header>

          {state?.message && <p className="performance-error">{renderMessage(state.message)}</p>}
          {snapshot ? (
            <>
              <div className="performance-trends">
                <MetricTrend label={tr('settings.cpuUsage')} value={snapshot.cpuPercent} history={history} nowMs={nowMs} warning={thresholds.cpu.warning} critical={thresholds.cpu.critical} series="cpu" />
                <MetricTrend label={tr('settings.memoryUsage')} value={snapshot.memoryPercent} history={history} nowMs={nowMs} warning={thresholds.memory.warning} critical={thresholds.memory.critical} series="memory" />
                <MetricTrend label={tr('settings.rootPartitionUsage')} value={snapshot.diskPercent} history={history} nowMs={nowMs} warning={thresholds.disk.warning} critical={thresholds.disk.critical} series="disk" />
                <div className="performance-trend-axis"><span>{tr('common.15MinAgo')}</span><span>{tr('common.now')}</span></div>
              </div>
              <div className="performance-details">
                <div className={'performance-detail-load ' + metricSeverity(snapshot.loadAverage[0] / snapshot.cpuCores, thresholds.loadPerCore.warning, thresholds.loadPerCore.critical)}>
                  <span>{tr('common.systemLoad')}</span>
                  <div>
                    {snapshot.loadAverage.map((load, index) => <span key={index}>{tr('common.loadWindow', { minutes: index === 0 ? 1 : index === 1 ? 5 : 15 })}<strong>{load.toFixed(2)}</strong></span>)}
                  </div>
                </div>
                <dl>
                  <div><dt>{tr('common.uptime')}</dt><dd>{formatUptime(snapshot.uptimeSeconds)}</dd></div>
                  <div><dt>{tr('common.logicalCpus')}</dt><dd>{tr('common.cpuCores', { count: snapshot.cpuCores })}</dd></div>
                  <div><dt>{tr('common.memory')}</dt><dd>{formatBytes(snapshot.memoryUsedBytes)} / {formatBytes(snapshot.memoryTotalBytes)}</dd></div>
                  <div><dt>{tr('common.rootPartition')}</dt><dd>{formatBytes(snapshot.diskUsedBytes)} / {formatBytes(snapshot.diskTotalBytes)}</dd></div>
                </dl>
              </div>
            </>
          ) : !state?.message ? <p className="performance-empty">{tr('common.metricsAppearAfterTheFirstSampleCpuUsageRequiresA')}</p> : null}
        </section>
      )}
    </div>
  )
}
