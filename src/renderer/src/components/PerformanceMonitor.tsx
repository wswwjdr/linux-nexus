import { useEffect, useRef } from 'react'
import { Gauge, RefreshCw, X } from 'lucide-react'
import type { PerformanceSnapshot, PerformanceThresholds } from '@shared/types'
import { performanceSeverity } from '@shared/performance'

export interface PerformanceMonitorState {
  sessionId: string
  monitorId: string
  status: 'sampling' | 'ready' | 'error'
  snapshot: PerformanceSnapshot | null
  message: string | null
  history: PerformanceSnapshot[]
}

interface PerformanceMonitorProps {
  state: PerformanceMonitorState | null
  thresholds: PerformanceThresholds
  open: boolean
  onOpenChange: (open: boolean) => void
  onRefresh: (sessionId: string, monitorId: string) => void
}

const WINDOW_MS = 15 * 60 * 1000
const HISTORY_LIMIT = 180

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
  return days > 0 ? `${days} 天 ${hours} 小时` : hours > 0 ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`
}

function metricSeverity(value: number | null, warning: number, critical: number): 'normal' | 'warning' | 'critical' | 'unavailable' {
  if (value === null) return 'unavailable'
  if (value >= critical) return 'critical'
  if (value >= warning) return 'warning'
  return 'normal'
}

function trendPath(history: PerformanceSnapshot[], key: 'cpuPercent' | 'memoryPercent' | 'diskPercent'): string {
  if (history.length === 0) return ''
  const latestTime = Date.parse(history.at(-1)!.sampledAt)
  return history.flatMap((snapshot, index) => {
    const value = snapshot[key]
    if (value === null) return []
    const age = latestTime - Date.parse(snapshot.sampledAt)
    const x = Math.max(0, Math.min(600, 600 * (1 - age / WINDOW_MS)))
    const y = 34 - Math.max(0, Math.min(100, value)) * 0.3
    return [`${index === 0 || history.slice(0, index).every((item) => item[key] === null) ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`]
  }).join(' ')
}

function MetricTrend({
  label,
  value,
  history,
  warning,
  critical,
  series,
}: {
  label: string
  value: number | null
  history: PerformanceSnapshot[]
  warning: number
  critical: number
  series: 'cpu' | 'memory' | 'disk'
}) {
  const severity = metricSeverity(value, warning, critical)
  const key = series === 'cpu' ? 'cpuPercent' : series === 'memory' ? 'memoryPercent' : 'diskPercent'
  const path = trendPath(history, key)
  return (
    <div className={'performance-trend-row ' + severity}>
      <div className="performance-trend-heading">
        <span>{label}</span>
        <strong>{percent(value)}</strong>
      </div>
      <svg className={'performance-trend-chart ' + series} viewBox="0 0 600 40" preserveAspectRatio="none" role="img" aria-label={`${label}最近 15 分钟趋势，纵轴 0 到 100%`}>
        <title>{label}最近 15 分钟趋势</title>
        <path className="performance-trend-grid" d="M0 4H600 M0 19H600 M0 34H600" />
        {path && <path className="performance-trend-line" d={path} />}
      </svg>
    </div>
  )
}

export default function PerformanceMonitor({ state, thresholds, open, onOpenChange, onRefresh }: PerformanceMonitorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const snapshot = state?.snapshot ?? null
  const severity = state?.status === 'error' || !snapshot
    ? 'unavailable'
    : performanceSeverity(snapshot, thresholds)
  const summaryLabel = state?.status === 'error'
    ? '性能指标不可用'
    : severity === 'critical' ? '服务器负载严重'
      : severity === 'warning' ? '服务器负载偏高'
        : snapshot ? '服务器状态正常' : '正在采集服务器性能指标'

  useEffect(() => {
    if (!open) return
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [open, onOpenChange])

  const history = (state?.history ?? []).slice(-HISTORY_LIMIT)
  const statusText = state?.status === 'error'
    ? '采集失败，将自动重试'
    : snapshot ? `最近更新 ${new Date(snapshot.sampledAt).toLocaleTimeString('zh-CN')}` : '正在读取服务器指标…'

  return (
    <div className="performance-monitor" ref={rootRef}>
      <button
        type="button"
        className={'performance-summary-button ' + severity}
        aria-label={`${summaryLabel}。CPU ${percent(snapshot?.cpuPercent ?? null)}，内存 ${percent(snapshot?.memoryPercent ?? null)}，磁盘 ${percent(snapshot?.diskPercent ?? null)}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={summaryLabel}
        onClick={() => onOpenChange(!open)}
      >
        <Gauge size={15} aria-hidden="true" />
        <span className="performance-summary-item"><small>CPU</small>{percent(snapshot?.cpuPercent ?? null)}</span>
        <span className="performance-summary-item"><small>内存</small>{percent(snapshot?.memoryPercent ?? null)}</span>
        <span className="performance-summary-item"><small>磁盘</small>{percent(snapshot?.diskPercent ?? null)}</span>
      </button>

      {open && (
        <section className="performance-popover" role="dialog" aria-label="服务器性能监控">
          <header className="performance-popover-header">
            <div>
              <h2>服务器性能</h2>
              <span className={'performance-status ' + severity} role="status" aria-live="off">{severity === 'normal' ? '正常' : severity === 'warning' ? '注意' : severity === 'critical' ? '严重' : '不可用'} · {statusText}</span>
            </div>
            <div className="performance-popover-actions">
              <button type="button" className="icon-button subtle" title="立即刷新" aria-label="立即刷新性能指标" disabled={!state || state.status === 'sampling'} onClick={() => state && onRefresh(state.sessionId, state.monitorId)}>
                <RefreshCw className={state?.status === 'sampling' ? 'spin' : ''} size={15} />
              </button>
              <button type="button" className="icon-button subtle" title="关闭" aria-label="关闭性能监控" onClick={() => onOpenChange(false)}><X size={15} /></button>
            </div>
          </header>

          {state?.message && <p className="performance-error">{state.message}</p>}
          {snapshot ? (
            <>
              <div className="performance-trends">
                <MetricTrend label="CPU 使用率" value={snapshot.cpuPercent} history={history} warning={thresholds.cpu.warning} critical={thresholds.cpu.critical} series="cpu" />
                <MetricTrend label="内存使用率" value={snapshot.memoryPercent} history={history} warning={thresholds.memory.warning} critical={thresholds.memory.critical} series="memory" />
                <MetricTrend label="根分区使用率" value={snapshot.diskPercent} history={history} warning={thresholds.disk.warning} critical={thresholds.disk.critical} series="disk" />
                <div className="performance-trend-axis"><span>15 分钟前</span><span>0%</span><span>50%</span><span>100%</span><span>现在</span></div>
              </div>
              <div className="performance-details">
                <div className={'performance-detail-load ' + metricSeverity(snapshot.loadAverage[0] / snapshot.cpuCores, thresholds.loadPerCore.warning, thresholds.loadPerCore.critical)}>
                  <span>系统负载</span>
                  <div>
                    {snapshot.loadAverage.map((load, index) => <span key={index}>{index === 0 ? '1' : index === 1 ? '5' : '15'} 分钟 <strong>{load.toFixed(2)}</strong></span>)}
                  </div>
                </div>
                <dl>
                  <div><dt>运行时长</dt><dd>{formatUptime(snapshot.uptimeSeconds)}</dd></div>
                  <div><dt>逻辑 CPU</dt><dd>{snapshot.cpuCores} 核</dd></div>
                  <div><dt>内存</dt><dd>{formatBytes(snapshot.memoryUsedBytes)} / {formatBytes(snapshot.memoryTotalBytes)}</dd></div>
                  <div><dt>根分区</dt><dd>{formatBytes(snapshot.diskUsedBytes)} / {formatBytes(snapshot.diskTotalBytes)}</dd></div>
                </dl>
              </div>
            </>
          ) : !state?.message ? <p className="performance-empty">首次采样后将显示指标，CPU 使用率需等待下一次样本。</p> : null}
        </section>
      )}
    </div>
  )
}
