import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_PERFORMANCE_THRESHOLDS } from '../src/shared/app-settings.ts'
import { createPerformanceSnapshot, parsePerformanceReport, performanceSeverity, performanceTrendPaths } from '../src/shared/performance.ts'
import type { PerformanceSnapshot } from '../src/shared/types.ts'

const report = [
  'cpu 100 0 50 800 0 0 0 0',
  'mem 1000000 250000',
  'load 1.50 1.20 0.80',
  'uptime 12345.6',
  'cores 4',
  'disk 1000000000 250000000 750000000 25%',
].join('\n')

test('parses remote performance fields and computes CPU, memory, and disk usage', () => {
  const first = parsePerformanceReport(report)
  const firstSnapshot = createPerformanceSnapshot(first, null, new Date('2026-10-22T00:00:00Z'))
  assert.equal(firstSnapshot.cpuPercent, null)
  assert.equal(firstSnapshot.memoryPercent, 75)
  assert.equal(firstSnapshot.memoryUsedBytes, 768000000)
  assert.equal(firstSnapshot.diskPercent, 25)
  assert.deepEqual(firstSnapshot.loadAverage, [1.5, 1.2, 0.8])

  const next = { ...first, cpuTicks: [120, 0, 60, 830, 0, 0, 0, 0] }
  const secondSnapshot = createPerformanceSnapshot(next, first.cpuTicks)
  assert.equal(secondSnapshot.cpuPercent, 50)
  assert.equal(createPerformanceSnapshot(first, next.cpuTicks).cpuPercent, null)
})

test('rejects malformed, missing, duplicated, and out-of-range remote fields', () => {
  assert.throws(() => parsePerformanceReport(report.replace('cores 4', '')))
  assert.throws(() => parsePerformanceReport(report.replace('mem 1000000 250000', 'mem 100 200')))
  assert.throws(() => parsePerformanceReport(report + '\ncores 4'))
  assert.throws(() => parsePerformanceReport(report.replace('cpu 100 0 50 800 0 0 0 0', 'cpu nope 0 50 800 0 0 0 0')))
})

test('normalizes load per logical CPU and returns the most severe metric state', () => {
  const snapshot = createPerformanceSnapshot(parsePerformanceReport(report), null)
  assert.equal(performanceSeverity(snapshot, DEFAULT_PERFORMANCE_THRESHOLDS), 'warning')
  assert.equal(performanceSeverity({ ...snapshot, cpuPercent: 92 }, DEFAULT_PERFORMANCE_THRESHOLDS), 'critical')
  assert.equal(performanceSeverity({ ...snapshot, memoryPercent: 40, loadAverage: [8, 1, 1] }, DEFAULT_PERFORMANCE_THRESHOLDS), 'critical')
})

test('draws each monitoring segment separately against the current 15 minute window', () => {
  const snapshot = (sampledAt: string, cpuPercent: number | null): PerformanceSnapshot => ({
    sampledAt,
    cpuPercent,
    memoryPercent: 50,
    memoryUsedBytes: 50,
    memoryTotalBytes: 100,
    diskPercent: 50,
    diskUsedBytes: 50,
    diskTotalBytes: 100,
    loadAverage: [0, 0, 0],
    uptimeSeconds: 1,
    cpuCores: 1,
  })
  const nowMs = Date.parse('2026-10-24T00:15:00Z')
  const paths = performanceTrendPaths([
    [
      snapshot('2026-10-24T00:00:00Z', 10),
      snapshot('2026-10-24T00:07:30Z', 20),
    ],
    [
      snapshot('2026-10-24T00:10:00Z', null),
      snapshot('2026-10-24T00:12:30Z', 50),
      snapshot('2026-10-24T00:15:00Z', 60),
    ],
    [
      snapshot('2026-10-23T23:59:00Z', 90),
      snapshot('2026-10-24T00:14:00Z', 40),
    ],
  ], 'cpuPercent', nowMs, 15 * 60 * 1000)
  assert.deepEqual(paths, [
    'M0.0,31.0 L300.0,28.0',
    'M500.0,19.0 L600.0,16.0',
    'M560.0,22.0',
  ])
})
