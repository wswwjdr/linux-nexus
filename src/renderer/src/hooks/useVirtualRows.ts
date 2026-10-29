import { useEffect, useState, type RefObject } from 'react'
export function useVirtualRows(viewportRef: RefObject<HTMLElement | null>, count: number, rowHeight: number, grid = false, highlightedIndex = -1) {
  const [viewport, setViewport] = useState({ top: 0, height: 600, width: 800 })
  useEffect(() => {
    const element = viewportRef.current!
    const measure = () => setViewport({ top: element.scrollTop, height: element.clientHeight || 600, width: element.clientWidth || 800 })
    measure()
    element.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect(); element.removeEventListener('scroll', measure) }
  }, [viewportRef])
  const columns = grid ? Math.max(1, Math.floor((viewport.width - 32) / 140)) : 1
  const rows = Math.ceil(count / columns)
  const enabled = count > 200
  const firstRow = enabled ? Math.max(0, Math.min(rows, Math.floor(viewport.top / rowHeight) - 5)) : 0
  const lastRow = enabled ? Math.min(rows, firstRow + Math.ceil(viewport.height / rowHeight) + 10) : rows
  useEffect(() => {
    if (highlightedIndex < 0 || !enabled) return
    const element = viewportRef.current!
    const top = Math.floor(highlightedIndex / columns) * rowHeight
    if (top < element.scrollTop || top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top
    setViewport(current => ({ ...current, top: element.scrollTop }))
  }, [highlightedIndex, rowHeight, columns, enabled, viewportRef])
  return { first: firstRow * columns, last: lastRow * columns, before: firstRow * rowHeight, after: (rows - lastRow) * rowHeight, columns }
}
