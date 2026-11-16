import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePerformanceMetrics, parseMountCapacity, parsePerformanceSample } from '../src/main/performance-sampling.ts'
import { mountFixture, performanceFixture } from './helpers/performance-fixture.ts'

test('one saturated logical CPU is visible when the aggregate averages its work across eight CPUs', () => {
  const first = parsePerformanceSample(performanceFixture())
  const initial = calculatePerformanceMetrics(first, null)
  assert.equal(initial.cpu.value?.percent, null)
  assert.equal(initial.network.value?.[0].receiveBytesPerSecond, null)
  assert.equal(initial.memory.value?.percent, 75)
  assert.deepEqual(initial.load.value, [2.5, 1.2, 0.8])
  assert.deepEqual(initial.swap.value, { totalBytes: 0, usedBytes: 0, availableBytes: 0, percent: null })

  const next = parsePerformanceSample(performanceFixture({ at: 104, step: 1 }))
  const metrics = calculatePerformanceMetrics(next, first)
  assert.equal(metrics.cpu.value?.percent, 12.5)
  assert.equal(metrics.cpu.value?.logical[0].percent, 100)
  assert.equal(metrics.cpu.value?.logical[7].percent, 0)
  assert.deepEqual(metrics.disks.value?.[0], {
    id: '8:0:sda', name: 'sda', readBytesPerSecond: 1024, writeBytesPerSecond: 512, readsPerSecond: 1, writesPerSecond: 0.5,
  })
  assert.deepEqual(metrics.network.value?.[0], { name: 'eth0', receiveBytesPerSecond: 512, transmitBytesPerSecond: 256 })
})

test('updates only existing resources and resets baselines for new, reset, or rebooted counters', () => {
  const first = parsePerformanceSample(performanceFixture({ ids: [0, 1, 2], step: 2 }))
  const next = parsePerformanceSample(performanceFixture({
    at: 104, step: 3, ids: [0, 2, 9], disks: '', network: 'eth0: 1 0 0 0 0 0 0 0 3000 0 0 0 0 0 0 0',
  }))
  const metrics = calculatePerformanceMetrics(next, first)
  assert.deepEqual(metrics.cpu.value?.logical, [
    { id: 0, percent: 100 }, { id: 2, percent: 0 }, { id: 9, percent: null },
  ])
  assert.deepEqual(metrics.disks.value, [])
  assert.equal(metrics.network.value?.[0].receiveBytesPerSecond, null)
  assert.equal(metrics.network.value?.[0].transmitBytesPerSecond, 113)

  const reboot = parsePerformanceSample(performanceFixture({ at: 108, boot: 600, step: 4 }))
  const rebootMetrics = calculatePerformanceMetrics(reboot, next)
  assert.equal(rebootMetrics.cpu.value?.logical[0].percent, null)
  assert.equal(rebootMetrics.network.value?.[0].receiveBytesPerSecond, null)
})

test('handles large CPU reports and validates sources independently', () => {
  const report = performanceFixture({ ids: Array.from({ length: 1024 }, (_, index) => index), failedSource: 'network',
    memory: 'MemTotal: 100 kB\nMemAvailable: 101 kB\nSwapTotal: 8 kB\nSwapFree: 2 kB\n' })
  assert.ok(Buffer.byteLength(report) > 16 * 1024)
  const raw = parsePerformanceSample(report)
  assert.equal(raw.cpu.value?.logical.size, 1024)
  assert.equal(raw.swap.value?.percent, 75)
  assert.ok(raw.network.error)
  assert.ok(raw.memory.error)
  assert.throws(() => parsePerformanceSample(report.slice(0, -1)))
  assert.ok(parsePerformanceSample(performanceFixture({ disks: '8 0 sda 1' })).disks.error)
})

test('parses fixed GNU df columns and preserves the whole mount path', () => {
  const mounts = parseMountCapacity(mountFixture)
  assert.deepEqual(mounts.map((mount) => mount.target), ['/', '/var/large  ', '/srv/Team Drive'])
  assert.deepEqual(mounts[1], { target: '/var/large  ', fsType: 'xfs', totalBytes: 100, usedBytes: 101, availableBytes: -1, percent: 101 })
  assert.throws(() => parseMountCapacity('df: unsupported option'))
  assert.throws(() => parseMountCapacity(mountFixture.replace('96%', 'wrong')))
})
