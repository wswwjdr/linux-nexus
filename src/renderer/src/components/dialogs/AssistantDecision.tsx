import { useEffect, useId, useRef, type ReactNode } from 'react'

/**
 * Renders a native modal for an assistant decision.
 * @param props The title, optional detail, action buttons and Escape handler.
 * @returns The dialog shown above the current view.
 */
export function AssistantDecision({ title, children, actions, onCancel }: {
  title: string; children?: ReactNode; actions: ReactNode; onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => {
      if (typeof dialog.close === 'function') dialog.close()
    }
  }, [])

  return <dialog ref={ref} className="assistant-decision" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); onCancel() }}>
    <h3 id={titleId}>{title}</h3>
    {children}
    <div className="assistant-actions">{actions}</div>
  </dialog>
}
