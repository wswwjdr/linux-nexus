import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown, ChevronRight, File, Folder, Link2 } from 'lucide-react'
import { formatLocale, tr } from '@shared/i18n/messages'
import type { RemoteDirectoryUsageNode } from '@shared/types'
import { formatSize } from '../app-utils'

const ROW_HEIGHT = 28

export default function DirectoryUsageTree({ nodes, path }: { nodes: RemoteDirectoryUsageNode[]; path: string }) {
  const viewport = useRef<HTMLDivElement>(null)
  const id = useId()
  const [expanded, setExpanded] = useState(() => new Set([0]))
  const [active, setActive] = useState(0)
  const locale = formatLocale()
  const { children, depths, hasSharedAllocation } = useMemo(() => {
    const children: number[][] = Array.from({ length: nodes.length }, () => [])
    const depths = new Array<number>(nodes.length)
    const collator = new Intl.Collator(locale, { numeric: true })
    let hasSharedAllocation = false
    nodes.forEach((node, index) => {
      const parent = node.parentIndex
      depths[index] = parent === null ? 0 : depths[parent] + 1
      if (parent !== null) children[parent].push(index)
      hasSharedAllocation ||= node.sharedAllocation
    })
    for (const siblings of children) {
      if (siblings.length > 1) siblings.sort((left, right) =>
        nodes[right].allocatedBytes - nodes[left].allocatedBytes || collator.compare(nodes[left].name, nodes[right].name))
    }
    return { children, depths, hasSharedAllocation }
  }, [nodes, locale])
  const visible = useMemo(() => {
    const rows: number[] = []
    const pending = [0]
    while (pending.length) {
      const index = pending.pop()!
      rows.push(index)
      if (!expanded.has(index)) continue
      for (let child = children[index].length - 1; child >= 0; child--) pending.push(children[index][child])
    }
    return rows
  }, [children, expanded])
  const keyFor = useCallback((index: number) => visible[index], [visible])
  const virtual = useVirtualizer({
    count: visible.length, getScrollElement: () => viewport.current,
    getItemKey: keyFor, estimateSize: () => ROW_HEIGHT, overscan: 8,
  })
  const rows = virtual.getVirtualItems()

  const toggle = (index: number) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const position = visible.indexOf(active)
    let nextPosition = position
    switch (event.key) {
      case 'ArrowDown': nextPosition = Math.min(position + 1, visible.length - 1); break
      case 'ArrowUp': nextPosition = Math.max(position - 1, 0); break
      case 'Home': nextPosition = 0; break
      case 'End': nextPosition = visible.length - 1; break
      case 'ArrowRight':
        if (children[active].length) {
          if (expanded.has(active)) nextPosition = position + 1
          else toggle(active)
        }
        break
      case 'ArrowLeft':
        if (children[active].length && expanded.has(active)) toggle(active)
        else if (nodes[active].parentIndex !== null) nextPosition = visible.indexOf(nodes[active].parentIndex)
        break
      case 'Enter':
      case ' ':
        if (children[active].length) toggle(active)
        break
      default: return
    }
    event.preventDefault()
    if (nextPosition === position) return
    setActive(visible[nextPosition])
    virtual.scrollToIndex(nextPosition, { align: 'auto' })
  }

  return <div className="directory-usage-tree">
    <div className="directory-usage-path" title={path}>{path}</div>
    <div className="directory-usage-columns" aria-hidden="true"><span>{tr('common.name')}</span><span>{tr('files.diskUsage')}</span></div>
    <div ref={viewport} className="directory-usage-viewport" role="tree" tabIndex={0} aria-label={tr('files.detailedDiskUsage')}
      aria-activedescendant={rows.some(row => visible[row.index] === active) ? `${id}-${active}` : undefined} onKeyDown={onKeyDown}>
      <div style={{ height: virtual.getTotalSize() }} role="none">
        {rows.map(row => {
          const index = visible[row.index]
          const { type, name, allocatedBytes, sharedAllocation } = nodes[index]
          const expandable = children[index].length > 0
          const open = expanded.has(index)
          const Icon = type === 'directory' ? Folder : type === 'symlink' ? Link2 : File
          const size = allocatedBytes.toLocaleString(locale)
          return <div key={index} id={`${id}-${index}`} role="treeitem" aria-level={depths[index] + 1} aria-expanded={expandable ? open : undefined}
            data-active={active === index} className="directory-usage-row" style={{ top: row.start, height: ROW_HEIGHT }}
            onClick={() => { viewport.current!.focus({ preventScroll: true }); setActive(index); if (expandable) toggle(index) }}>
            <span className="directory-usage-name" style={{ paddingInlineStart: `min(${depths[index] * 14}px, 40%)` }}>
              <span className="directory-usage-chevron" aria-hidden="true">{expandable && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}</span>
              <Icon size={14} aria-hidden="true" />
              <bdi title={name}>{name}</bdi>
            </span>
            <span className="directory-usage-size" title={tr('files.bytes', { value1: formatSize(allocatedBytes), value2: size })}>
              {sharedAllocation && <span className="directory-usage-shared" title={tr('files.sharedDiskAllocation')}>
                <Link2 size={13} aria-label={tr('files.sharedDiskAllocation')} role="img" />
              </span>}
              {formatSize(allocatedBytes)}
            </span>
          </div>
        })}
      </div>
    </div>
    {hasSharedAllocation && <p className="file-properties-hint"><Link2 size={13} aria-hidden="true" />{tr('files.sharedDiskAllocation')}</p>}
  </div>
}
