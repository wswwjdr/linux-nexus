import { type MessageValue, msg, LocalizedError } from './i18n/messages'
import type { PerformanceSnapshot, PerformanceThreshold, PerformanceThresholds } from './types'

export interface RawPerformanceMetrics {
  cpuTicks: number[]
  memoryTotalKiB: number
  memoryAvailableKiB: number
  loadAverage: [number, number, number]
  uptimeSeconds: number
  cpuCores: number
  diskTotalBytes: number
  diskUsedBytes: number
}

export type PerformanceSeverity = 'normal' | 'warning' | 'critical'
export type PerformanceSeries = 'cpuPercent' | 'memoryPercent' | 'diskPercent'

export function performanceTrendPaths(
  history: PerformanceSnapshot[][],
  series: PerformanceSeries,
  nowMs: number,
  windowMs: number,
): string[] {
  const startMs = nowMs - windowMs
  return history.flatMap((segment) => {
    const paths: string[] = []
    let points: string[] = []
    const flush = () => {
      if (points.length) paths.push(points.join(' '))
      points = []
    }

    for (const snapshot of segment) {
      const sampledAt = Date.parse(snapshot.sampledAt)
      const value = snapshot[series]
      if (sampledAt < startMs || sampledAt > nowMs || value === null) {
        flush()
        continue
      }
      const x = Math.max(0, Math.min(600, 600 * ((sampledAt - startMs) / windowMs)))
      const y = 34 - Math.max(0, Math.min(100, value)) * 0.3
      points.push(`${points.length ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    flush()
    return paths
  })
}

const requiredFields = ['cpu', 'mem', 'load', 'uptime', 'cores', 'disk']

function parseNumber(value: string, label: MessageValue, integer = false): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new LocalizedError(msg('errors.invalidRemotePerformanceData', { "label": label }))
  }
  return number
}

export function parsePerformanceReport(output: string): RawPerformanceMetrics {
  const fields = new Map<string, string[]>()
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    const separator = trimmed.indexOf(' ')
    if (separator < 0) continue
    const key = trimmed.slice(0, separator)
    if (!requiredFields.includes(key)) continue
    if (fields.has(key)) throw new LocalizedError(msg('errors.duplicateFieldInRemotePerformanceData', { "key": key }))
    fields.set(key, trimmed.slice(separator + 1).trim().split(/\s+/))
  }

  for (const key of requiredFields) {
    if (!fields.has(key)) throw new LocalizedError(msg('errors.missingFieldInRemotePerformanceData', { "key": key }))
  }

  const cpuValues = fields.get('cpu')!
  if (cpuValues.length !== 8) throw new LocalizedError(msg('errors.invalidRemoteCpuDataFormat'))
  const cpuTicks = cpuValues.map((value) => parseNumber(value, 'CPU'))

  const memoryValues = fields.get('mem')!
  if (memoryValues.length !== 2) throw new LocalizedError(msg('errors.invalidRemoteMemoryDataFormat'))
  const memoryTotalKiB = parseNumber(memoryValues[0], msg('errors.totalMemory'))
  const memoryAvailableKiB = parseNumber(memoryValues[1], msg('errors.availableMemory'))
  if (memoryTotalKiB <= 0 || memoryAvailableKiB > memoryTotalKiB) throw new LocalizedError(msg('errors.remoteMemoryDataIsOutOfRange'))

  const loadValues = fields.get('load')!
  if (loadValues.length !== 3) throw new LocalizedError(msg('errors.invalidRemoteLoadDataFormat'))
  const loadAverage = loadValues.map((value) => parseNumber(value, msg('common.systemLoad'))) as [number, number, number]

  const uptimeValues = fields.get('uptime')!
  const coresValues = fields.get('cores')!
  if (uptimeValues.length !== 1 || coresValues.length !== 1) throw new LocalizedError(msg('errors.invalidRemoteUptimeOrCpuCoreCountFormat'))
  const uptimeSeconds = parseNumber(uptimeValues[0], msg('common.uptime'))
  const cpuCores = parseNumber(coresValues[0], msg('errors.cpuCoreCount'), true)
  if (cpuCores < 1) throw new LocalizedError(msg('errors.invalidRemoteCpuCoreCount'))

  const diskValues = fields.get('disk')!
  if (diskValues.length !== 4 || !/^\d+%$/.test(diskValues[3])) throw new LocalizedError(msg('errors.invalidRemoteRootPartitionDataFormat'))
  const diskTotalBytes = parseNumber(diskValues[0], msg('errors.rootPartitionTotalSize'), true)
  const diskUsedBytes = parseNumber(diskValues[1], msg('errors.rootPartitionUsedSpace'), true)
  const diskAvailableBytes = parseNumber(diskValues[2], msg('errors.rootPartitionAvailableSpace'), true)
  if (diskTotalBytes <= 0 || diskUsedBytes > diskTotalBytes || diskAvailableBytes > diskTotalBytes) {
    throw new LocalizedError(msg('errors.remoteRootPartitionDataIsOutOfRange'))
  }

  return {
    cpuTicks,
    memoryTotalKiB,
    memoryAvailableKiB,
    loadAverage,
    uptimeSeconds,
    cpuCores,
    diskTotalBytes,
    diskUsedBytes,
  }
}

export function createPerformanceSnapshot(
  raw: RawPerformanceMetrics,
  previousCpuTicks: number[] | null,
  sampledAt = new Date(),
): PerformanceSnapshot {
  let cpuPercent: number | null = null
  if (previousCpuTicks) {
    if (previousCpuTicks.length !== raw.cpuTicks.length) throw new LocalizedError(msg('errors.remoteCpuCounterStructureChanged'))
    const differences = raw.cpuTicks.map((value, index) => value - previousCpuTicks[index])
    const reset = differences.some((difference) => difference < 0)
    const total = reset ? 0 : differences.reduce((sum, value) => sum + value, 0)
    if (!reset && total > 0) {
      const idle = differences[3] + differences[4]
      cpuPercent = Math.min(100, Math.max(0, ((total - idle) / total) * 100))
    }
  }

  const memoryTotalBytes = raw.memoryTotalKiB * 1024
  const memoryUsedBytes = (raw.memoryTotalKiB - raw.memoryAvailableKiB) * 1024
  return {
    sampledAt: sampledAt.toISOString(),
    cpuPercent,
    memoryPercent: (memoryUsedBytes / memoryTotalBytes) * 100,
    memoryUsedBytes,
    memoryTotalBytes,
    diskPercent: (raw.diskUsedBytes / raw.diskTotalBytes) * 100,
    diskUsedBytes: raw.diskUsedBytes,
    diskTotalBytes: raw.diskTotalBytes,
    loadAverage: raw.loadAverage,
    uptimeSeconds: raw.uptimeSeconds,
    cpuCores: raw.cpuCores,
  }
}

function thresholdSeverity(value: number | null, threshold: PerformanceThreshold): PerformanceSeverity {
  if (value === null) return 'normal'
  if (value >= threshold.critical) return 'critical'
  if (value >= threshold.warning) return 'warning'
  return 'normal'
}

export function performanceSeverity(
  snapshot: PerformanceSnapshot,
  thresholds: PerformanceThresholds,
): PerformanceSeverity {
  const severities = [
    thresholdSeverity(snapshot.cpuPercent, thresholds.cpu),
    thresholdSeverity(snapshot.memoryPercent, thresholds.memory),
    thresholdSeverity(snapshot.diskPercent, thresholds.disk),
    thresholdSeverity(snapshot.loadAverage[0] / snapshot.cpuCores, thresholds.loadPerCore),
  ]
  if (severities.includes('critical')) return 'critical'
  if (severities.includes('warning')) return 'warning'
  return 'normal'
}
