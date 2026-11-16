import { useState, type ReactNode } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick, type LucideIcon } from 'lucide-react'
import { tr } from '@shared/i18n/messages'
import type { PerformanceMetric, PerformanceMonitorState, PerformanceThresholds, ResourceCapacity } from '@shared/types'
import { bytes, current, number, percent, severity, type Severity } from './presentation'
import { Meter, MetricNotice, ThresholdAlert } from './PerformanceReadings'

interface CardProps {
  label: string
  icon: LucideIcon
  value: string
  metric?: PerformanceMetric<unknown>
  level: Severity
  meter?: number | null
  children?: ReactNode
}

/**
 * Presents one headline reading and its supporting details.
 * @param props Card label, icon, metric, threshold status and optional details.
 * @returns A labeled metric card with any relevant notices.
 */
function MetricCard({ label, icon: Icon, value, metric, level, meter, children }: CardProps) {
  return <section className="performance-card">
    <div className="performance-card-heading">
      <h3><span className="performance-card-icon"><Icon size={17} aria-hidden="true" /></span>{label}</h3>
      <ThresholdAlert level={level} />
    </div>
    <strong className={`performance-value ${level}`}>{value}</strong>
    {meter !== undefined && <Meter value={meter} level={level} />}
    {children}
    <MetricNotice metric={metric} />
  </section>
}

/**
 * Summarizes used and available space for a capacity reading.
 * @param props Capacity value in bytes.
 * @returns Two localized lines of supporting information.
 */
function CapacityNotes({ value }: { value: ResourceCapacity }) {
  return <div className="performance-capacity-notes">
    <span>{tr('performance.capacityUsed', { used: bytes(value.usedBytes), total: bytes(value.totalBytes) })}</span>
    <span>{tr('performance.capacityAvailable', { available: bytes(value.availableBytes) })}</span>
  </div>
}

/**
 * Builds the headline cards and per-core breakdown from the latest metric snapshots.
 * @param props Metric snapshots and configured thresholds.
 * @returns The dashboard overview.
 */
export function PerformanceOverview({ metrics, thresholds }: Pick<PerformanceMonitorState, 'metrics'> & { thresholds: PerformanceThresholds }) {
  const [allCores, setAllCores] = useState(false)
  const cpu = metrics.cpu?.latest?.value
  const memory = metrics.memory?.latest?.value
  const swap = metrics.swap?.latest?.value
  const root = metrics.mounts?.latest?.value.find((mount) => mount.target === '/')
  const load = metrics.load?.latest?.value
  const activeCores = current(metrics.cpu)?.logical.length
  const currentLoad = current(metrics.load)
  const hottest = cpu?.logical.reduce<typeof cpu.logical[number] | undefined>((highest, core) =>
    core.percent !== null && core.percent > (highest?.percent ?? -1) ? core : highest, undefined)

  return <>
    <div className="performance-overview">
      <MetricCard label={tr('settings.cpuUsage')} icon={Cpu} value={percent(cpu?.percent)} metric={metrics.cpu}
        level={severity(current(metrics.cpu)?.percent, thresholds.cpu)} meter={cpu?.percent ?? null}>
        {cpu && <span className="performance-note">{tr('common.logicalCpus')} · {number(cpu.logical.length, 0)}</span>}
        {cpu?.percent === null && !metrics.cpu?.error && <p className="performance-note">{tr('performance.waitingForCounters')}</p>}
      </MetricCard>
      <MetricCard label={tr('common.memory')} icon={MemoryStick} value={percent(memory?.percent)} metric={metrics.memory}
        level={severity(current(metrics.memory)?.percent, thresholds.memory)} meter={memory?.percent ?? null}>
        {memory && <CapacityNotes value={memory} />}
        {swap && <div className="performance-swap">
          {swap.totalBytes
            ? <><span>Swap <strong>{percent(swap.percent)}</strong></span><CapacityNotes value={swap} /></>
            : <span>{tr('performance.swapDisabled')}</span>}
        </div>}
        <MetricNotice metric={metrics.swap} />
      </MetricCard>
      <MetricCard label={tr('performance.rootDisk')} icon={HardDrive} value={percent(root?.percent)} metric={metrics.mounts}
        level={severity(current(metrics.mounts)?.find((mount) => mount.target === '/')?.percent, thresholds.disk)} meter={root?.percent ?? null}>
        {root && <CapacityNotes value={root} />}
        {!root && current(metrics.mounts) && <p className="performance-note">{tr('performance.rootUnavailable')}</p>}
      </MetricCard>
      <MetricCard label={tr('common.systemLoad')} icon={Activity} value={load ? number(load[0], 2) : '—'} metric={metrics.load}
        level={severity(activeCores && currentLoad ? currentLoad[0] / activeCores : null, thresholds.loadPerCore)}>
        <span className="performance-note">{tr('common.loadWindow', { minutes: 1 })}</span>
        <dl className="performance-load">
          {([5, 15] as const).map((minutes, index) => <div key={minutes}>
            <dt>{tr('common.loadWindow', { minutes })}</dt>
            <dd>{load ? number(load[index + 1], 2) : '—'}</dd>
          </div>)}
        </dl>
      </MetricCard>
    </div>
    {!!cpu?.logical.length && <section className="performance-card performance-core-card">
      <div className="performance-block-heading">
        <div>
          <h3>{tr('common.logicalCpus')}</h3>
          {hottest?.percent != null && <p className="performance-note">{tr('performance.busiestCpu', { cpu: hottest.id, usage: percent(hottest.percent) })}</p>}
        </div>
        {cpu.logical.length > 16 && <button type="button" className="performance-control"
          aria-expanded={allCores} onClick={() => setAllCores(!allCores)}>
          {allCores ? tr('performance.fewerCores') : tr('performance.allCores', { count: cpu.logical.length })}
        </button>}
      </div>
      {metrics.cpu?.error && <MetricNotice metric={metrics.cpu} />}
      <ul className="performance-cpu-list" aria-label={tr('common.logicalCpus')}>
        {(allCores ? cpu.logical : cpu.logical.slice(0, 16)).map(({ id, percent: usage }) => {
          const level = severity(metrics.cpu?.error ? null : usage, thresholds.cpu)
          return <li key={id}>
            <span>CPU {id}</span>
            <Meter value={usage} level={level} />
            <strong className={level}>{percent(usage)}</strong>
            <ThresholdAlert level={level} />
          </li>
        })}
      </ul>
    </section>}
  </>
}
