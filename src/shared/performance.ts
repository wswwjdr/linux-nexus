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

const requiredFields = ['cpu', 'mem', 'load', 'uptime', 'cores', 'disk']

function parseNumber(value: string, label: string, integer = false): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error('远端性能数据无效：' + label)
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
    if (fields.has(key)) throw new Error('远端性能数据包含重复字段：' + key)
    fields.set(key, trimmed.slice(separator + 1).trim().split(/\s+/))
  }

  for (const key of requiredFields) {
    if (!fields.has(key)) throw new Error('远端性能数据缺少字段：' + key)
  }

  const cpuValues = fields.get('cpu')!
  if (cpuValues.length !== 8) throw new Error('远端 CPU 数据格式无效')
  const cpuTicks = cpuValues.map((value) => parseNumber(value, 'CPU'))

  const memoryValues = fields.get('mem')!
  if (memoryValues.length !== 2) throw new Error('远端内存数据格式无效')
  const memoryTotalKiB = parseNumber(memoryValues[0], '内存总量')
  const memoryAvailableKiB = parseNumber(memoryValues[1], '可用内存')
  if (memoryTotalKiB <= 0 || memoryAvailableKiB > memoryTotalKiB) throw new Error('远端内存数据超出有效范围')

  const loadValues = fields.get('load')!
  if (loadValues.length !== 3) throw new Error('远端负载数据格式无效')
  const loadAverage = loadValues.map((value) => parseNumber(value, '系统负载')) as [number, number, number]

  const uptimeValues = fields.get('uptime')!
  const coresValues = fields.get('cores')!
  if (uptimeValues.length !== 1 || coresValues.length !== 1) throw new Error('远端运行时长或 CPU 核数格式无效')
  const uptimeSeconds = parseNumber(uptimeValues[0], '运行时长')
  const cpuCores = parseNumber(coresValues[0], 'CPU 核数', true)
  if (cpuCores < 1) throw new Error('远端 CPU 核数无效')

  const diskValues = fields.get('disk')!
  if (diskValues.length !== 4 || !/^\d+%$/.test(diskValues[3])) throw new Error('远端根分区数据格式无效')
  const diskTotalBytes = parseNumber(diskValues[0], '根分区总量', true)
  const diskUsedBytes = parseNumber(diskValues[1], '根分区已用量', true)
  const diskAvailableBytes = parseNumber(diskValues[2], '根分区可用量', true)
  if (diskTotalBytes <= 0 || diskUsedBytes > diskTotalBytes || diskAvailableBytes > diskTotalBytes) {
    throw new Error('远端根分区数据超出有效范围')
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
    if (previousCpuTicks.length !== raw.cpuTicks.length) throw new Error('远端 CPU 计数器结构发生变化')
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
