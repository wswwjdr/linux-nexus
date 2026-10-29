import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { RemoteEntryRenameDialogState } from '../features/remote-files/useRemoteOperations'
import { errorMessage } from '../app-utils'

interface RemoteEntryRenameDialogProps {
  state: RemoteEntryRenameDialogState
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}

export default function RemoteEntryRenameDialog({ state, onSubmit, onClose }: RemoteEntryRenameDialogProps) {
  const [name, setName] = useState(state.entry.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current!
    input.focus()
    const extensionStart = state.entry.name.lastIndexOf('.')
    input.setSelectionRange(0, state.entry.type === 'file' && extensionStart > 0 ? extensionStart : state.entry.name.length)
  }, [state.entry])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!submittingRef.current) onClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [onClose])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
      setError('名称不能为空，不能是 . 或 ..，也不能包含 / 或空字符')
      return
    }
    submittingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
    } catch (reason) {
      setError('重命名失败：' + errorMessage(reason))
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="rename-entry-title">
        <div className="modal-heading">
          <h2 id="rename-entry-title">{state.entry.type === 'directory' ? '重命名文件夹' : '重命名文件'}</h2>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={busy} onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>名称</span>
            <input
              ref={inputRef}
              autoCapitalize="none"
              autoComplete="off"
              required
              disabled={busy}
              value={name}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'rename-entry-error' : undefined}
              onChange={(event) => { setName(event.target.value); setError(null) }}
            />
          </label>
          {error && <div id="rename-entry-error" className="confirmation-error" role="alert">{error}</div>}
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {busy ? '重命名中' : '重命名'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
