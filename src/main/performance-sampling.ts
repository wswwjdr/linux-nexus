import { LocalizedError, messageFromUnknown, msg, type MessageValue } from '../shared/i18n/messages'
import type { CpuUsage, DiskActivity, MountUsage, NetworkActivity, ResourceCapacity } from '../shared/types/performance'

const sources = {
  uptime: '/proc/uptime',
  stat: '/proc/stat',
  load: '/proc/loadavg',
  memory: '/proc/meminfo',
  disks: '/proc/diskstats',
  network: '/proc/net/dev',
} as const

// Each proc file has its own exit status. Proc text cannot contain the NUL frame separator.
export const PERFORMANCE_COMMAND = [
  'export LC_ALL=C',
  "read_source() { printf '%s\\000' \"$1\"; cat -- \"$2\"; printf '\\000%s\\000' \"$?\"; }",
  ...Object.entries(sources).map(([key, path]) => 'read_source ' + key + ' ' + path),
].join('\n')

export const MOUNT_CAPACITY_COMMAND = 'LC_ALL=C exec df --local --block-size=1 --output=fstype,size,used,avail,pcent,target'

type Source = keyof typeof sources
type Result<T> = { value: T; error?: never } | { value?: never; error: MessageValue }
type CpuCounters = { bootTime: number; total: bigint[]; logical: Map<number, bigint[]> }
type DiskCounters = { name: string; reads: bigint; writes: bigint; sectorsRead: bigint; sectorsWritten: bigint }
type NetworkCounters = { received: bigint; transmitted: bigint }

interface RawPerformanceSample {
  uptime: Result<number>
  cpu: Result<CpuCounters>
  load: Result<[number, number, number]>
  memory: Result<ResourceCapacity>
  swap: Result<ResourceCapacity>
  disks: Result<Map<string, DiskCounters>>
  network: Result<Map<string, NetworkCounters>>
}

/** Reports malformed values from source with a localized error. */
function invalid(source: string): never {
  throw new LocalizedError(msg('errors.invalidRemotePerformanceData', { label: source }))
}

/** Converts a localized source failure into a result while propagating programming errors from read. */
function capture<T>(read: () => T): Result<T> {
  try {
    return { value: read() }
  } catch (error) {
    if (!(error instanceof LocalizedError)) throw error
    return { error: messageFromUnknown(error) }
  }
}

/** Parses an unsigned decimal counter from value without losing precision. */
function counter(value: string | undefined, source: string): bigint {
  if (!value || !/^\d{1,20}$/.test(value)) invalid(source)
  const result = BigInt(value)
  if (result > 0xffff_ffff_ffff_ffffn) invalid(source)
  return result
}

/** Parses an unsigned integer from value within the exact numeric range of the renderer. */
function integer(value: string | undefined, source: string): number {
  const result = Number(counter(value, source))
  if (!Number.isSafeInteger(result)) invalid(source)
  return result
}

/** Parses a finite nonnegative measurement from a proc field. */
function decimal(value: string | undefined, source: string): number {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) invalid(source)
  return Number(value)
}

/** Parses a single kernel stat report into aggregate, logical CPU, and boot counters. */
function parseCpu(body: string): CpuCounters {
  const source = sources.stat
  let total: bigint[] | undefined
  let bootTime: number | undefined
  const logical = new Map<number, bigint[]>()
  for (const line of body.trim().split('\n')) {
    const [label, ...values] = line.trim().split(/\s+/)
    if (label === 'btime') {
      if (bootTime !== undefined || values.length !== 1) invalid(source)
      bootTime = integer(values[0], source)
      continue
    }
    if (!/^cpu\d*$/.test(label)) continue
    if (values.length < 8) invalid(source)
    // Guest time is already included in user and nice.
    const ticks = values.slice(0, 8).map((value) => counter(value, source))
    if (label === 'cpu') {
      if (total) invalid(source)
      total = ticks
    } else {
      const id = integer(label.slice(3), source)
      if (logical.has(id)) invalid(source)
      logical.set(id, ticks)
    }
  }
  if (!total || !logical.size || bootTime === undefined) invalid(source)
  return { total, logical, bootTime }
}

/** Reads total and available KiB for one resource from meminfo and returns byte capacities. */
function parseMemory(body: string, totalKey: string, availableKey: string): ResourceCapacity {
  const values = new Map<string, number>()
  for (const line of body.split('\n')) {
    const [key, amount, unit, ...rest] = line.trim().split(/\s+/)
    if (key !== totalKey && key !== availableKey) continue
    const bytes = integer(amount, sources.memory) * 1024
    if (values.has(key) || unit !== 'kB' || rest.length || !Number.isSafeInteger(bytes)) invalid(sources.memory)
    values.set(key, bytes)
  }
  const totalBytes = values.get(totalKey)
  const availableBytes = values.get(availableKey)
  if (totalBytes === undefined || availableBytes === undefined || availableBytes > totalBytes
    || (totalKey === 'MemTotal:' && totalBytes === 0)) invalid(sources.memory)
  const usedBytes = totalBytes - availableBytes
  return { totalBytes, usedBytes, availableBytes, percent: totalBytes === 0 ? null : 100 * usedBytes / totalBytes }
}

/** Parses per-device counters, keyed by major/minor numbers and kernel device name. */
function parseDisks(body: string): Map<string, DiskCounters> {
  const devices = new Map<string, DiskCounters>()
  for (const line of body.trim().split('\n').filter(Boolean)) {
    const [major, minor, name, ...fields] = line.trim().split(/\s+/)
    const id = [integer(major, sources.disks), integer(minor, sources.disks), name].join(':')
    if (!name || fields.length < 11 || devices.has(id)) invalid(sources.disks)
    const [reads, , sectorsRead, , writes, , sectorsWritten] = fields.slice(0, 7).map((field) => counter(field, sources.disks))
    devices.set(id, { name, reads, writes, sectorsRead, sectorsWritten })
  }
  return devices
}

/** Parses per-interface byte counters from the kernel network report. */
function parseNetwork(body: string): Map<string, NetworkCounters> {
  const [directions, headings, ...rows] = body.trim().split('\n')
  if (!directions.includes('|') || !headings?.includes('|')) invalid(sources.network)
  const interfaces = new Map<string, NetworkCounters>()
  for (const row of rows) {
    const separator = row.lastIndexOf(':')
    const name = row.slice(0, separator).trim()
    const fields = row.slice(separator + 1).trim().split(/\s+/)
    if (separator < 0 || !name || /\s/.test(name) || fields.length !== 16 || interfaces.has(name)) invalid(sources.network)
    interfaces.set(name, { received: counter(fields[0], sources.network), transmitted: counter(fields[8], sources.network) })
  }
  return interfaces
}

/** Reads the fixed SSH frames from output, preserving success or failure for each metric source. */
export function parsePerformanceSample(output: string): RawPerformanceSample {
  const fields = output.split('\0')
  const entries = Object.entries(sources)
  if (fields.length !== entries.length * 3 + 1 || fields.at(-1) !== '') invalid('procfs')
  const bodies = new Map<string, { data: string; status: string }>()
  for (const [index, [key]] of entries.entries()) {
    const [name, data, status] = fields.slice(index * 3, index * 3 + 3)
    if (name !== key || !/^\d{1,3}$/.test(status)) invalid('procfs')
    bodies.set(key, { data, status })
  }
  /** Reads a checked source body or reports the remote read failure. */
  const read = (key: Source): string => {
    const body = bodies.get(key)!
    if (body.status !== '0') throw new LocalizedError(msg('performance.sourceFailed', { source: sources[key], code: body.status }))
    return body.data
  }
  return {
    uptime: capture(() => decimal(read('uptime').trim().split(/\s+/)[0], sources.uptime)),
    cpu: capture(() => parseCpu(read('stat'))),
    load: capture(() => {
      const [one, five, fifteen] = read('load').trim().split(/\s+/)
      return [decimal(one, sources.load), decimal(five, sources.load), decimal(fifteen, sources.load)]
    }),
    memory: capture(() => parseMemory(read('memory'), 'MemTotal:', 'MemAvailable:')),
    swap: capture(() => parseMemory(read('memory'), 'SwapTotal:', 'SwapFree:')),
    disks: capture(() => parseDisks(read('disks'))),
    network: capture(() => parseNetwork(read('network'))),
  }
}

/** Parses GNU df's fixed columns. The final column consumes the complete mount path, including spaces. */
export function parseMountCapacity(output: string): MountUsage[] {
  const [heading, ...rows] = output.replace(/\n$/, '').split('\n')
  if (!/^\s*Type\s+\S+\s+Used\s+Avail\s+Use%\s+Mounted on\s*$/.test(heading)) invalid('df')
  const mounts: MountUsage[] = []
  for (const row of rows) {
    const match = /^\s*(\S+)\s+(\d+|-)\s+(\d+|-)\s+(-?\d+|-)\s+(\d+%|-)\s+(\/.*)$/.exec(row)
    if (!match) invalid('df')
    const [, fsType, size, used, available, usage, target] = match
    if ([size, used, available, usage].includes('-')) continue
    const totalBytes = integer(size, 'df')
    const usedBytes = integer(used, 'df')
    const availableBytes = available.startsWith('-') ? -integer(available.slice(1), 'df') : integer(available, 'df')
    const percent = integer(usage.slice(0, -1), 'df')
    mounts.push({ target, fsType, totalBytes, usedBytes, availableBytes, percent })
  }
  return mounts.sort((a, b) => Number(b.target === '/') - Number(a.target === '/')
    || (b.percent ?? 0) - (a.percent ?? 0) || a.target.localeCompare(b.target))
}

/** Calculates busy time from two sets of CPU counters, or returns null if no valid interval exists. */
function cpuPercent(next: bigint[], previous: bigint[] | undefined): number | null {
  if (!previous) return null
  const delta = next.map((value, index) => value - previous[index])
  if (delta.some((value) => value < 0n)) return null
  const total = delta.reduce((sum, value) => sum + value, 0n)
  if (total === 0n) return null
  return 100 * Number(total - delta[3] - delta[4]) / Number(total)
}

/** Converts an unsigned cumulative counter into units per second over a positive remote interval. */
function rate(next: bigint, previous: bigint | undefined, seconds: number, units = 1): number | null {
  return previous === undefined || next < previous ? null : Number(next - previous) * units / seconds
}

/** Transforms a successful result through project, forwarding localized source errors as-is. */
function mapResult<T, U>(result: Result<T>, project: (input: T) => U): Result<U> {
  return result.error !== undefined ? { error: result.error } : { value: project(result.value) }
}

/** Derives UI metrics from consecutive remote samples, discarding baselines after a restart or clock failure. */
export function calculatePerformanceMetrics(next: RawPerformanceSample, previous: RawPerformanceSample | null) {
  const elapsed = (next.uptime.value ?? 0) - (previous?.uptime.value ?? Infinity)
  const oldBoot = previous?.cpu.value?.bootTime
  const newBoot = next.cpu.value?.bootTime
  const baseline = elapsed > 0 && (oldBoot === undefined || newBoot === undefined || oldBoot === newBoot)
    ? previous : null
  return {
    uptime: next.uptime,
    cpu: mapResult(next.cpu, ({ total, logical }): CpuUsage => ({
      percent: cpuPercent(total, baseline?.cpu.value?.total),
      logical: [...logical].sort(([a], [b]) => a - b).map(([id, ticks]) => ({
        id, percent: cpuPercent(ticks, baseline?.cpu.value?.logical.get(id)),
      })),
    })),
    load: next.load,
    memory: next.memory,
    swap: next.swap,
    disks: mapResult(next.disks, (disks): DiskActivity[] => Array.from(disks, ([id, disk]) => {
      const prior = baseline?.disks.value?.get(id)
      return {
        id, name: disk.name,
        readBytesPerSecond: rate(disk.sectorsRead, prior?.sectorsRead, elapsed, 512),
        writeBytesPerSecond: rate(disk.sectorsWritten, prior?.sectorsWritten, elapsed, 512),
        readsPerSecond: rate(disk.reads, prior?.reads, elapsed),
        writesPerSecond: rate(disk.writes, prior?.writes, elapsed),
      }
    }).sort((a, b) => a.name.localeCompare(b.name))),
    network: mapResult(next.network, (network): NetworkActivity[] => Array.from(network, ([name, iface]) => {
      const prior = baseline?.network.value?.get(name)
      return {
        name,
        receiveBytesPerSecond: rate(iface.received, prior?.received, elapsed),
        transmitBytesPerSecond: rate(iface.transmitted, prior?.transmitted, elapsed),
      }
    }).sort((a, b) => a.name.localeCompare(b.name))),
  }
}
