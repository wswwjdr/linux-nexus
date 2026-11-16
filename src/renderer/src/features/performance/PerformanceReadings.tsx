import { AlertCircle, TriangleAlert } from 'lucide-react'
import { renderMessage, tr } from '@shared/i18n/messages'
import type { PerformanceMetric } from '@shared/types'
import { sampleTime, type Severity } from './presentation'

/**
 * Explains a pending or failed metric.
 * @param props Metric with its last successful sample and source error.
 * @returns A notice when the reading is pending or failed.
 */
export function MetricNotice({ metric }: { metric?: PerformanceMetric<unknown> }) {
  if (!metric?.latest && !metric?.error) return <p className="performance-note">{tr('performance.waiting')}</p>
  if (!metric?.error) return null
  return <p className="performance-error">
    <AlertCircle size={15} aria-hidden="true" />
    <span>{metric.latest ? tr('performance.lastSuccessfulSample', { time: sampleTime(metric.latest.sampledAt) })
      : tr('common.unavailable')} · {renderMessage(metric.error)}</span>
  </p>
}

/**
 * Shows an explicit alert label for a threshold breach.
 * @param props Severity to present.
 * @returns Visible alert badge when a threshold is reached.
 */
export function ThresholdAlert({ level }: { level: Severity }) {
  if (level !== 'warning' && level !== 'critical') return null
  return <span className={`performance-alert ${level}`}>
    {level === 'critical' ? <AlertCircle size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
    {tr(level === 'critical' ? 'settings.critical' : 'settings.warning')}
  </span>
}

/**
 * Draws a visual meter beside a percentage reading.
 * @param props Reading and optional threshold severity.
 * @returns A meter with its fill constrained to the track.
 */
export function Meter({ value, level = 'normal' }: { value: number | null | undefined; level?: Severity }) {
  return <span className={`performance-meter ${level}`} aria-hidden="true">
    <span style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
  </span>
}
