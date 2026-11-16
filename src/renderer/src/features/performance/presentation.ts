import { formatLocale, tr } from '@shared/i18n/messages'
import type { PerformanceMetric, PerformanceThreshold } from '@shared/types'

/**
 * Formats a numeric reading for the current language.
 * @param value Reading to format.
 * @param digits Maximum fractional digits.
 * @returns Localized number.
 */
export function number(value: number, digits = 1): string {
  return value.toLocaleString(formatLocale(), { maximumFractionDigits: digits })
}

/**
 * Formats a percentage already expressed on a 0–100 scale.
 * @param value Percentage, or an unavailable reading.
 * @returns Localized percentage or a dash.
 */
export function percent(value: number | null | undefined): string {
  return value == null ? '—' : (value / 100).toLocaleString(formatLocale(), { style: 'percent', maximumFractionDigits: 1 })
}

/**
 * Formats a signed byte reading using IEC units.
 * @param value Bytes or bytes per second.
 * @param perSecond Whether the reading is a rate.
 * @returns Localized reading with its unit, or a dash.
 */
export function bytes(value: number | null, perSecond = false): string {
  if (value === null) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const scale = Math.min(units.length - 1, Math.floor(Math.log2(Math.max(Math.abs(value), 1)) / 10))
  const amount = number(value / 1024 ** scale)
  const unit = units[scale]
  return perSecond ? tr('performance.bytesPerSecond', { amount, unit }) : amount + ' ' + unit
}

/**
 * Formats a sample timestamp in local time.
 * @param sampledAt Sample epoch in milliseconds.
 * @returns Localized time.
 */
export function sampleTime(sampledAt: number): string {
  return new Date(sampledAt).toLocaleTimeString(formatLocale())
}

/**
 * Formats a server's uptime in its two largest time units.
 * @param seconds Elapsed seconds since boot.
 * @returns Localized duration.
 */
export function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor(seconds % 86400 / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  if (days) return tr('common.dH', { days, hours })
  if (hours) return tr('common.hM', { hours, minutes })
  return tr('common.min', { minutes })
}

/**
 * Evaluates a live reading against its configured thresholds.
 * @param value Current reading in the threshold's units.
 * @param threshold Warning and critical boundaries.
 * @returns Display severity.
 */
export function severity(value: number | null | undefined, threshold: PerformanceThreshold) {
  if (value == null) return 'unavailable'
  if (value >= threshold.critical) return 'critical'
  return value >= threshold.warning ? 'warning' : 'normal'
}

export type Severity = ReturnType<typeof severity>

/**
 * Extracts a current reading.
 * @param metric Latest snapshot and source status.
 * @returns Latest successful value while the source is healthy.
 */
export function current<T>(metric: PerformanceMetric<T> | undefined): T | undefined {
  return metric?.error == null ? metric?.latest?.value : undefined
}
