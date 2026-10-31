import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { FlipHorizontal2, FlipVertical2, ImageOff, LoaderCircle, Maximize, RotateCcw, RotateCw, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { PreviewResult } from '@shared/types'
import { imageFitScale, zoomAt, type Point, type Size } from './image-transform'

export default function ImagePreviewDialog({ result, active, onClose }: {
  result: Extract<PreviewResult, { type: 'image' }>; active: boolean; onClose: () => void
}) {
  const titleId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; start: Point; pan: Point; moved: boolean; background: boolean } | null>(null)
  const [viewport, setViewport] = useState<Size>({ width: 1, height: 1 })
  const [image, setImage] = useState<Size | null>(null)
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const [rotation, setRotation] = useState(0)
  const [flip, setFlip] = useState({ x: 1, y: 1 })
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const scale = image ? imageFitScale(image, viewport, rotation) * view.zoom : 1

  useEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current!
    if (active) dialog.focus()
    return () => { if (dialog.contains(document.activeElement) && previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useLayoutEffect(() => {
    const element = viewportRef.current!
    const measure = () => {
      // Hidden workspaces retain the last usable fit until they become visible again.
      if (element.clientWidth && element.clientHeight) setViewport({ width: element.clientWidth, height: element.clientHeight })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element); measure()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (!active) {
      if (drag.current && viewportRef.current!.hasPointerCapture(drag.current.id)) viewportRef.current!.releasePointerCapture(drag.current.id)
      drag.current = null; setDragging(false)
    }
  }, [active])
  const zoom = useCallback((delta: number, anchor: Point = { x: 0, y: 0 }) => {
    setView((view) => zoomAt(view.zoom, view.zoom + delta, view.pan, anchor))
  }, [])
  useEffect(() => {
    const element = viewportRef.current!
    const wheel = (event: WheelEvent) => {
      if (!active || status !== 'ready' || event.deltaY === 0) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      zoom(event.deltaY > 0 ? -.15 : .15, { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 })
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [active, status, zoom])
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!active || event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, pan: view.pan, moved: false,
      background: !(event.target as HTMLElement).closest('[data-image-content]') }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    const x = event.clientX - current.start.x, y = event.clientY - current.start.y
    if (Math.hypot(x, y) > 3) current.moved = true
    if (current.moved) {
      setDragging(true)
      setView((view) => ({ ...view, pan: { x: current.pan.x + x, y: current.pan.y + y } }))
    }
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.id !== event.pointerId) return
    drag.current = null; setDragging(false)
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (!current.moved && current.background) onClose()
  }
  return <div className="modal-backdrop preview-backdrop ip-overlay" role="presentation">
    <section className="ip-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} inert={!active}>
      <header className="ip-header"><div className="ip-info"><h2 id={titleId} title={result.name}>{result.name}</h2>{image && <span>{image.width} × {image.height}</span>}</div>
        <button className="ip-close" aria-label="关闭预览" title="关闭 (Esc)" onClick={onClose}><X size={24} /></button>
      </header>
      <div className={'ip-viewport' + (dragging ? ' dragging' : '')} ref={viewportRef} onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={() => { drag.current = null; setDragging(false) }} onLostPointerCapture={() => { drag.current = null; setDragging(false) }}>
        {status === 'loading' && <div className="ip-status" role="status"><LoaderCircle size={42} className="spin" /><span>加载中</span></div>}
        {status === 'error' ? <div className="ip-status" role="alert"><ImageOff size={48} /><span>图片加载失败</span><button onClick={() => { setStatus('loading'); setAttempt(attempt + 1) }}>重试</button></div>
          : <div className="ip-translation" data-image-content style={{ transform: `translate(-50%, -50%) translate(${view.pan.x}px, ${view.pan.y}px) scale(${scale})`, transition: dragging ? 'none' : undefined }}>
            <img key={attempt} className="ip-image" src={result.url} alt={result.name} draggable={false} style={{ visibility: status === 'ready' ? 'visible' : 'hidden', transform: `rotate(${rotation}deg) scale(${flip.x}, ${flip.y})` }}
              onLoad={(event) => { setImage({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setStatus('ready') }} onError={() => setStatus('error')} />
          </div>}
      </div>
      <div className="ip-toolbar" role="toolbar" aria-label="图片操作">
        <button title="缩小" aria-label="缩小" disabled={status !== 'ready' || view.zoom <= .1} onClick={() => zoom(-.15)}><ZoomOut size={20} /></button>
        <span className="ip-scale" aria-live="polite">{Math.round(view.zoom * 100)}%</span>
        <button title="放大" aria-label="放大" disabled={status !== 'ready' || view.zoom >= 10} onClick={() => zoom(.15)}><ZoomIn size={20} /></button>
        <span className="ip-divider" />
        <button title="适应窗口" aria-label="适应窗口" disabled={status !== 'ready'} onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })}><Maximize size={20} /></button>
        <span className="ip-divider" />
        <button title="逆时针旋转" aria-label="逆时针旋转" disabled={status !== 'ready'} onClick={() => setRotation(rotation - 90)}><RotateCcw size={20} /></button>
        <button title="顺时针旋转" aria-label="顺时针旋转" disabled={status !== 'ready'} onClick={() => setRotation(rotation + 90)}><RotateCw size={20} /></button>
        <button title="水平翻转" aria-label="水平翻转" disabled={status !== 'ready'} onClick={() => setFlip({ ...flip, x: -flip.x })}><FlipHorizontal2 size={20} /></button>
        <button title="垂直翻转" aria-label="垂直翻转" disabled={status !== 'ready'} onClick={() => setFlip({ ...flip, y: -flip.y })}><FlipVertical2 size={20} /></button>
      </div>
    </section>
  </div>
}
