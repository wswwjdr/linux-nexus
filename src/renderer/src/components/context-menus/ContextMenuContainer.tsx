import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { ContextMenuPosition } from '@/app-types'

interface ContextMenuContainerProps {
  position: ContextMenuPosition
  label: string
  elementRef: RefObject<HTMLDivElement | null>
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  children: ReactNode
}

export default function ContextMenuContainer({ position, label, elementRef, onKeyDown, children }: ContextMenuContainerProps) {
  return (
    <div
      className="browser-context-menu"
      ref={elementRef}
      role="menu"
      aria-label={label}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}
