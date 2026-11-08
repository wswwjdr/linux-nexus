import { msg, renderMessage, type MessageValue, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
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
  useLanguage()
  const [name, setName] = useState(state.entry.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageValue | null>(null)
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
      setError(msg('files.nameMustNotBeEmptyBeOrOrContainOr'))
      return
    }
    submittingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onSubmit(name)
    } catch (reason) {
      setError(msg('files.renameFailed', { "value1": errorMessage(reason) }))
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="rename-entry-title">
        <div className="modal-heading">
          <h2 id="rename-entry-title">{state.entry.type === 'directory' ? tr('files.renameFolder') : tr('files.renameFile')}</h2>
          <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} disabled={busy} onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>{tr('common.name')}</span>
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
          {error && <div id="rename-entry-error" className="confirmation-error" role="alert">{renderMessage(error)}</div>}
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{tr('common.cancel')}</button>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {busy ? tr('files.renaming') : tr('files.rename')}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
