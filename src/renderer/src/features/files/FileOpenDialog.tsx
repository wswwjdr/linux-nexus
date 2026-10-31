import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
import { Eye, X } from 'lucide-react'
import type { PreviewType } from '@shared/file-type-registry'
import { previewTypeLabels } from '@shared/preview-file-type'

interface FileOpenDialogProps {
  name: string
  types: PreviewType[]
  onSelect: (type: PreviewType) => void
  onClose: () => void
}

export default function FileOpenDialog({ name, types, onSelect, onClose }: FileOpenDialogProps) {
  const id = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null
    dialogRef.current!.querySelector<HTMLButtonElement>('[data-preview-type]')!.focus()
  }, [])

  const close = () => {
    onClose()
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
  }

  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const buttons = Array.from(dialogRef.current!.querySelectorAll<HTMLButtonElement>('button'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Tab') {
      if (event.shiftKey && index === 0) { event.preventDefault(); buttons[buttons.length - 1].focus() }
      else if (!event.shiftKey && index === buttons.length - 1) { event.preventDefault(); buttons[0].focus() }
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const options = buttons.filter((button) => button.dataset.previewType)
      const current = options.indexOf(document.activeElement as HTMLButtonElement)
      options[(current + (event.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length].focus()
    }
  }

  return (
    <div className="modal-backdrop file-open-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="modal file-open-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={id + '-title'} aria-describedby={id + '-name'} onKeyDown={handleKeyDown}>
        <header className="modal-heading">
          <h2 id={id + '-title'}>选择打开方式</h2>
          <button type="button" className="icon-button modal-close" aria-label="关闭" title="关闭" onClick={close}><X size={18} /></button>
        </header>
        <p className="file-open-name" id={id + '-name'}>{name}</p>
        <div className="file-open-options">
          {types.map((type) => (
            <button type="button" className="secondary-button" data-preview-type={type} key={type} onClick={() => onSelect(type)}>
              <Eye size={16} />{previewTypeLabels[type]}
            </button>
          ))}
        </div>
        <footer className="modal-footer"><button type="button" className="secondary-button" onClick={close}>取消</button></footer>
      </section>
    </div>
  )
}
