import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, HardDrive, Network, Workflow } from 'lucide-react'
import { tr } from '@shared/i18n/messages'
import type { PerformanceMetric, PerformanceMonitorState, PerformanceThresholds } from '@shared/types'
import { bytes, number, percent, sampleTime, severity } from './presentation'
import { Meter, MetricNotice, ThresholdAlert } from './PerformanceReadings'

const pageSize = 10
const tabs = [
  { id: 'mounts', label: 'performance.storageTab', icon: HardDrive },
  { id: 'disks', label: 'performance.ioTab', icon: Workflow },
  { id: 'network', label: 'performance.networkTab', icon: Network },
] as const

type ResourceKind = typeof tabs[number]['id']
interface ResourceRow {
  id: string
  name: string
  secondary: boolean
  cells: ReactNode[]
}
interface ResourceView {
  label: string
  columns: string[]
  rows: ResourceRow[]
  metric?: PerformanceMetric<unknown>
  waiting?: boolean
}

/**
 * Builds the selected table from its latest resource snapshot.
 * @param kind Resource tab to display.
 * @param metrics Latest snapshots and source errors.
 * @param thresholds Configured utilization thresholds.
 * @returns Table columns, rows and source status.
 */
function resourceView(kind: ResourceKind, metrics: PerformanceMonitorState['metrics'], thresholds: PerformanceThresholds): ResourceView {
  if (kind === 'mounts') {
    const metric = metrics.mounts
    const mounts = metric?.latest?.value ?? []
    return {
      label: tr('performance.mounts'),
      columns: [tr('performance.mountPoint'), tr('performance.fileSystem'), tr('performance.total'),
        tr('performance.used'), tr('performance.available'), tr('performance.utilization')],
      metric,
      rows: [...mounts].sort((a, b) => Number(b.target === '/') - Number(a.target === '/')).map((mount) => {
        const level = severity(metric?.error ? null : mount.percent, thresholds.disk)
        return {
          id: mount.target, name: mount.target, secondary: mount.target !== '/' && mount.fsType === 'overlay',
          cells: [mount.fsType, bytes(mount.totalBytes), bytes(mount.usedBytes), bytes(mount.availableBytes),
            <div className="performance-row-usage">
              <strong className={level}>{percent(mount.percent)}</strong>
              <Meter value={mount.percent} level={level} />
              <ThresholdAlert level={level} />
            </div>],
        }
      }),
    }
  }

  if (kind === 'disks') {
    const metric = metrics.disks
    const disks = metric?.latest?.value ?? []
    return {
      label: tr('performance.diskIo'),
      columns: [tr('performance.device'), tr('performance.read'), tr('performance.write'),
        tr('performance.readIops'), tr('performance.writeIops')],
      metric,
      waiting: disks.some((disk) => disk.readBytesPerSecond === null || disk.writeBytesPerSecond === null
        || disk.readsPerSecond === null || disk.writesPerSecond === null),
      rows: disks.map((disk) => ({
        id: disk.id, name: disk.name, secondary: /^loop\d+$/.test(disk.name),
        cells: [bytes(disk.readBytesPerSecond, true), bytes(disk.writeBytesPerSecond, true),
          disk.readsPerSecond === null ? '—' : number(disk.readsPerSecond),
          disk.writesPerSecond === null ? '—' : number(disk.writesPerSecond)],
      })),
    }
  }

  const metric = metrics.network
  const interfaces = metric?.latest?.value ?? []
  return {
    label: tr('performance.network'),
    columns: [tr('performance.interface'), tr('performance.receive'), tr('performance.transmit')],
    metric,
    waiting: interfaces.some((iface) => iface.receiveBytesPerSecond === null || iface.transmitBytesPerSecond === null),
    rows: interfaces.map((iface) => ({
      id: iface.name, name: iface.name, secondary: /^(?:lo$|veth|docker|br-)/.test(iface.name),
      cells: [bytes(iface.receiveBytesPerSecond, true), bytes(iface.transmitBytesPerSecond, true)],
    })),
  }
}

/**
 * Displays a long name in an expandable row heading.
 * @param props Resource name.
 * @returns The name or a keyboard operable disclosure for the full text.
 */
function ResourceName({ name }: { name: string }) {
  if (name.length <= 24) return <span className="performance-resource-name">{name}</span>
  return <details className="performance-resource-name">
    <summary title={name}>{name}</summary>
  </details>
}

/**
 * Displays a resource group with at most one page of rows at a time.
 * @param props Table label, columns and resource rows.
 * @returns A table and paging controls, or an empty-state notice.
 */
function ResourceTable({ label, columns, rows }: Pick<ResourceView, 'label' | 'columns' | 'rows'>) {
  const [requestedPage, setPage] = useState(0)
  if (!rows.length) return <p className="performance-note performance-table-empty">{tr('performance.noResources')}</p>
  const pageCount = Math.ceil(rows.length / pageSize)
  const page = Math.min(requestedPage, pageCount - 1)
  return <>
    <div className="performance-table-viewport">
      <table className="performance-table" aria-label={label}>
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {rows.slice(page * pageSize, (page + 1) * pageSize).map(({ id, name, cells }) => <tr key={id}>
            <th scope="row"><ResourceName name={name} /></th>
            {cells.map((cell, index) => <td key={index}>{cell}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    {pageCount > 1 && <div className="performance-pagination">
      <span aria-live="polite">{tr('performance.pageCount', { page: page + 1, total: pageCount })}</span>
      <button type="button" className="icon-button subtle" aria-label={tr('performance.previousPage')}
        disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
      <button type="button" className="icon-button subtle" aria-label={tr('performance.nextPage')}
        disabled={page === pageCount - 1} onClick={() => setPage(page + 1)}><ChevronRight size={16} aria-hidden="true" /></button>
    </div>}
  </>
}

/**
 * Presents the resources and sample state for an active tab.
 * @param props Selected tab and its table data.
 * @returns Source status and primary and secondary resource groups.
 */
function ResourcePanel({ kind, view }: { kind: ResourceKind; view: ResourceView }) {
  const primary = view.rows.filter((row) => !row.secondary)
  const secondary = view.rows.filter((row) => row.secondary)
  const secondaryLabel = tr(kind === 'mounts' ? 'performance.overlayGroup' : kind === 'disks'
    ? 'performance.loopGroup' : 'performance.virtualGroup', { count: secondary.length })

  return <>
    <div className="performance-block-heading">
      <h4>{view.label}</h4>
      {view.metric?.latest && !view.metric.error && <span className="performance-note">
        {tr('common.lastUpdated', { value1: sampleTime(view.metric.latest.sampledAt) })}
      </span>}
    </div>
    <MetricNotice metric={view.metric} />
    {view.waiting && !view.metric?.error && <p className="performance-note">{tr('performance.waitingForCounters')}</p>}
    {view.metric?.latest && <>
      {primary.length > 0 || !secondary.length
        ? <ResourceTable label={view.label} columns={view.columns} rows={primary} />
        : <p className="performance-note performance-table-empty">{tr('performance.noPrimaryResources')}</p>}
      {secondary.length > 0 && <details className="performance-resource-group">
        <summary>{secondaryLabel}</summary>
        <ResourceTable label={secondaryLabel} columns={view.columns} rows={secondary} />
      </details>}
    </>}
  </>
}

/**
 * Provides a keyboard accessible browser for storage, I/O and network data.
 * @param props Metric snapshots and utilization thresholds.
 * @returns Resource browser with one active table panel.
 */
export function PerformanceResources({ metrics, thresholds }: Pick<PerformanceMonitorState, 'metrics'> & { thresholds: PerformanceThresholds }) {
  const [active, setActive] = useState(0)
  const id = useId()
  const kind = tabs[active].id

  /**
   * Changes the selection and focus with the standard horizontal tab shortcuts.
   * @param event Keyboard event from the tablist.
   */
  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    let index = active
    switch (event.key) {
      case 'ArrowRight': index = (active + 1) % tabs.length; break
      case 'ArrowLeft': index = (active + tabs.length - 1) % tabs.length; break
      case 'Home': index = 0; break
      case 'End': index = tabs.length - 1; break
      default: return
    }
    event.preventDefault()
    setActive(index)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
  }

  return <section className="performance-card performance-resources">
    <div className="performance-block-heading">
      <h3>{tr('performance.resources')}</h3>
      <div className="performance-tabs" role="tablist" aria-label={tr('performance.resources')} onKeyDown={navigate}>
        {tabs.map(({ id: tab, label, icon: Icon }, index) => <button type="button" role="tab" key={tab}
          id={`${id}-${tab}`} aria-controls={`${id}-panel`} aria-selected={active === index}
          tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)}>
          <Icon size={15} aria-hidden="true" />{tr(label)}
        </button>)}
      </div>
    </div>
    <div className="performance-tabpanel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${kind}`} tabIndex={0}>
      <ResourcePanel key={kind} kind={kind} view={resourceView(kind, metrics, thresholds)} />
    </div>
  </section>
}
