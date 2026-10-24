import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { RemoteEntry } from '@shared/types'

interface SelectionDrag {
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  additive: boolean
  initialPaths: string[]
  moved: boolean
}

interface SelectionRectangle {
  left: number
  top: number
  width: number
  height: number
}

export function isSelectionBackground(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !target.closest('[data-entry-path], button, a, input, select, textarea, th, .file-drop-overlay')
}

interface UseFileSelectionOptions {
  contentRef: RefObject<HTMLDivElement | null>
  currentPath: string
  entries: RemoteEntry[]
  sortedEntries: RemoteEntry[]
  selectedPaths: string[]
  onSelectedPathsChange: (paths: string[]) => void
}

export function useFileSelection({
  contentRef,
  currentPath,
  entries,
  sortedEntries,
  selectedPaths,
  onSelectedPathsChange,
}: UseFileSelectionOptions) {
  const selectionDragRef = useRef<SelectionDrag | null>(null)
  const selectionAnchorRef = useRef<string | null>(null)
  const selectedPathsRef = useRef(selectedPaths)
  const previousPathRef = useRef(currentPath)
  const suppressClickRef = useRef(false)
  const suppressClickTimerRef = useRef<number | null>(null)
  const [selectionRectangle, setSelectionRectangle] = useState<SelectionRectangle | null>(null)
  selectedPathsRef.current = selectedPaths

  useLayoutEffect(() => {
    if (previousPathRef.current === currentPath) return
    previousPathRef.current = currentPath
    selectionAnchorRef.current = null
    contentRef.current?.focus({ preventScroll: true })
  }, [contentRef, currentPath])

  useEffect(() => {
    const updateSelection = (event: globalThis.PointerEvent) => {
      const drag = selectionDragRef.current
      const content = contentRef.current
      const bounds = content?.getBoundingClientRect()
      if (!drag || !content || !bounds || drag.pointerId !== event.pointerId) return

      const currentX = Math.max(bounds.left, Math.min(event.clientX, bounds.right))
      const currentY = Math.max(bounds.top, Math.min(event.clientY, bounds.bottom))
      const moved = drag.moved || Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4
      selectionDragRef.current = { ...drag, currentX, currentY, moved }
      if (!moved) return

      const rectangle = {
        left: Math.min(drag.startX, currentX),
        top: Math.min(drag.startY, currentY),
        right: Math.max(drag.startX, currentX),
        bottom: Math.max(drag.startY, currentY),
      }
      setSelectionRectangle({
        left: rectangle.left,
        top: rectangle.top,
        width: rectangle.right - rectangle.left,
        height: rectangle.bottom - rectangle.top,
      })

      const next = new Set(drag.additive ? drag.initialPaths : [])
      for (const element of content.querySelectorAll<HTMLElement>('[data-entry-path]')) {
        const item = element.getBoundingClientRect()
        if (item.right >= rectangle.left && item.left <= rectangle.right && item.bottom >= rectangle.top && item.top <= rectangle.bottom) {
          const path = element.dataset.entryPath
          if (path) next.add(path)
        }
      }
      onSelectedPathsChange([...next])
    }

    const handlePointerUp = (event: globalThis.PointerEvent) => {
      const drag = selectionDragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      updateSelection(event)
      const moved = selectionDragRef.current?.moved ?? false
      selectionDragRef.current = null
      setSelectionRectangle(null)
      if (!moved) return
      contentRef.current?.focus({ preventScroll: true })
      suppressClickRef.current = true
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
        suppressClickTimerRef.current = null
      }, 0)
    }

    window.addEventListener('pointermove', updateSelection)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', updateSelection)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [contentRef, onSelectedPathsChange, sortedEntries])

  useEffect(() => {
    selectionDragRef.current = null
    setSelectionRectangle(null)
  }, [currentPath, entries])

  useEffect(() => () => {
    if (suppressClickTimerRef.current !== null) window.clearTimeout(suppressClickTimerRef.current)
  }, [])

  const handleSelectionPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || !isSelectionBackground(event.target)) return
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    suppressClickRef.current = false
    event.preventDefault()
    selectionDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      additive: event.ctrlKey || event.metaKey,
      initialPaths: selectedPathsRef.current,
      moved: false,
    }
  }

  const handleEntryClick = (path: string, event: MouseEvent<HTMLElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    if (event.shiftKey) {
      const entryIndexes = new Map(sortedEntries.map((entry, index): [string, number] => [entry.path, index]))
      const clickedIndex = entryIndexes.get(path)
      const selectedAnchor = [...selectedPathsRef.current].reverse().find((selectedPath) => entryIndexes.has(selectedPath))
      const currentAnchor = selectionAnchorRef.current
      const anchorPath = currentAnchor && entryIndexes.has(currentAnchor) ? currentAnchor : selectedAnchor ?? path
      const anchorIndex = entryIndexes.get(anchorPath)
      if (clickedIndex === undefined || anchorIndex === undefined) return
      const start = Math.min(anchorIndex, clickedIndex)
      const end = Math.max(anchorIndex, clickedIndex)
      const next = new Set(event.ctrlKey || event.metaKey ? selectedPathsRef.current : [])
      for (const entry of sortedEntries.slice(start, end + 1)) next.add(entry.path)
      selectionAnchorRef.current = anchorPath
      onSelectedPathsChange([...next])
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedPathsRef.current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      selectionAnchorRef.current = path
      onSelectedPathsChange([...next])
      return
    }
    selectionAnchorRef.current = path
    onSelectedPathsChange([path])
  }

  const consumeSuppressedBackgroundClick = () => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    if (suppressClickTimerRef.current !== null) {
      window.clearTimeout(suppressClickTimerRef.current)
      suppressClickTimerRef.current = null
    }
    return true
  }

  return {
    selectionRectangle,
    selectedPathsRef,
    selectionAnchorRef,
    handleSelectionPointerDown,
    handleEntryClick,
    consumeSuppressedBackgroundClick,
  }
}
