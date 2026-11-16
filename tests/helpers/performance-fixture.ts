import type { PerformanceMonitorState } from '../../src/shared/types/performance.ts'

interface FixtureOptions {
  at?: number
  step?: number
  boot?: number
  ids?: number[]
  network?: string
  disks?: string
  memory?: string
  failedSource?: string
}

/** Builds a framed procfs sample with predictable counters and optional source changes. */
export function performanceFixture({ at = 100, step = 0, boot = 500, ids = Array.from({ length: 8 }, (_, index) => index),
  network, disks, memory, failedSource }: FixtureOptions = {}): string {
  const stats = [
    'cpu ' + (ids.length * 100 + step * 100) + ' 0 0 ' + (ids.length * 200 + (ids.length - 1) * step * 100) + ' 0 0 0 0 0 0',
    ...ids.map((id) => 'cpu' + id + ' ' + (100 + (id === 0 ? step * 100 : 0)) + ' 0 0 '
      + (200 + (id !== 0 ? step * 100 : 0)) + ' 0 0 0 0 0 0'),
    'btime ' + boot,
  ].join('\n') + '\n'
  return Object.entries({
    uptime: at + ' 200\n',
    stat: stats,
    load: '2.50 1.20 0.80 5/442 42\n',
    memory: memory ?? 'MemTotal: 10000 kB\nMemAvailable: 2500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
    disks: disks ?? ['8 0 sda', 10 + step * 4, 0, 100 + step * 8, 0, 50 + step * 2, 0, 200 + step * 4, 0, 0, 0, 0].join(' '),
    network: 'Inter-| Receive | Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed\n'
      + (network ?? ' eth0: ' + (9007199254740993n + BigInt(step) * 2048n) + ' 0 0 0 0 0 0 0 ' + (500 + step * 1024) + ' 0 0 0 0 0 0 0'),
  }).map(([key, body]) => [key, body, key === failedSource ? '1' : '0', ''].join('\0')).join('')
}

export const mountFixture = [
  'Type 1B-blocks Used Avail Use% Mounted on',
  'ext4 100 96 4 96% /srv/Team Drive',
  'overlay 100 50 50 50% /',
  'xfs 100 101 -1 101% /var/large  ',
  '',
].join('\n')

/** Provides representative UI state with coreCount logical CPUs and every resource section populated. */
export function performanceUiFixture(coreCount = 8): PerformanceMonitorState {
  const sampledAt = Date.now()
  const gibibyte = 1024 ** 3
  /** Wraps value in a successful metric snapshot with the common fixture timestamp. */
  const metric = <T>(value: T) => ({ latest: { sampledAt, value }, error: null })
  return {
    profileId: 'server', connected: true, version: 1, enabled: true, sampling: false,
    metrics: {
      cpu: metric({ percent: 100 / coreCount, logical: Array.from({ length: coreCount }, (_, id) => ({ id, percent: id === 0 ? 100 : 0 })) }),
      memory: metric({ totalBytes: 8 * gibibyte, usedBytes: 4 * gibibyte, availableBytes: 4 * gibibyte, percent: 50 }),
      swap: metric({ totalBytes: 0, usedBytes: 0, availableBytes: 0, percent: null }),
      load: metric<[number, number, number]>([.35, .42, .38]),
      uptime: metric(123456),
      mounts: metric([
        { target: '/', fsType: 'ext4', totalBytes: 100 * gibibyte,
          usedBytes: 61 * gibibyte, availableBytes: 39 * gibibyte, percent: 61 },
        { target: '/var/lib/docker/overlay2/' + 'a'.repeat(64) + '/merged', fsType: 'overlay', totalBytes: 100 * gibibyte,
          usedBytes: 61 * gibibyte, availableBytes: 39 * gibibyte, percent: 61 },
      ]),
      disks: metric([{ id: '8:0:sda', name: 'sda', readBytesPerSecond: null, writeBytesPerSecond: 512,
        readsPerSecond: null, writesPerSecond: 1 }]),
      network: metric([{ name: 'eth0', receiveBytesPerSecond: 1024, transmitBytesPerSecond: 512 }]),
    },
  }
}
