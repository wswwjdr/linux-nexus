import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { tr } from '@shared/i18n/messages'

type Side = 'left' | 'right'
interface Layout { side: Side; ratio: number }
const storageKey = 'assistant-layout'
const initial: Layout = { side: 'right', ratio: .45 }

/** Restores the global assistant placement and split ratio. */
function readLayout(): Layout {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (value && ['left', 'right'].includes(value.side) && Number.isFinite(value.ratio)) return value
  } catch { return initial }
  return initial
}

/** Hosts the file browser and assistant without remounting either when their placement changes. */
export function AssistantSplit({ children, assistant }: {
  children: ReactNode
  assistant?: (controls: { side: Side; expanded: boolean; narrow: boolean; swap: () => void; expand: () => void }) => ReactNode
}) {
  const workspace = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(readLayout)
  const [width, setWidth] = useState(0)
  const [expanded, setExpanded] = useState(false)
  useLayoutEffect(() => {
    const element = workspace.current!
    setWidth(element.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const narrow = width < 800
  const usable = Math.max(0, width - 7)
  const assistantWidth = Math.max(360, Math.min(usable - 400, Math.round(layout.ratio * usable)))
  const split = Boolean(assistant && !narrow && !expanded)
  useLayoutEffect(() => { if (!assistant) setExpanded(false) }, [Boolean(assistant)])

  /** Applies and saves the requested global placement. */
  function update(next: Layout): void {
    setLayout(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Layout can still be used for this launch. */ }
  }

  /** Moves the divider, keeping both panes above their minimum widths. */
  function resize(pixels: number): void {
    if (!split) return
    update({ ...layout, ratio: Math.max(360, Math.min(usable - 400, pixels)) / usable })
  }

  return <div className={'assistant-split assistant-' + layout.side} ref={workspace}>
    <div className="assistant-file-pane" hidden={Boolean(assistant && !split)}>{children}</div>
    {split && <div className="assistant-divider" role="separator" aria-orientation="vertical"
      aria-label={tr('assistant.resize')} aria-valuemin={360} aria-valuemax={usable - 400}
      aria-valuenow={assistantWidth} tabIndex={0}
      onKeyDown={(event) => {
        const direction = layout.side === 'left' ? 1 : -1
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          resize(assistantWidth + direction * (event.key === 'ArrowRight' ? 24 : -24))
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const bounds = workspace.current!.getBoundingClientRect()
        resize((layout.side === 'left' ? event.clientX - bounds.left : bounds.right - event.clientX) - 3)
      }} />}
    {assistant && <div className="assistant-pane" style={{ width: split ? assistantWidth : '100%' }}>
      {assistant({ side: layout.side, expanded, narrow, swap: () => update({ ...layout, side: layout.side === 'left' ? 'right' : 'left' }),
        expand: () => setExpanded((current) => !current) })}
    </div>}
  </div>
}
