import { type MessageValue, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useRef } from 'react'
import ConfirmationDialog from '../ConfirmationDialog'

interface FileRootPasswordDialogProps {
  busy: boolean
  error?: MessageValue
  onSubmit: (password: string) => void
  onCancel: () => void
}

export default function FileRootPasswordDialog({ busy, error, onSubmit, onCancel }: FileRootPasswordDialogProps) {
  useLanguage()
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!busy) input.current?.focus()
  }, [busy])
  const submit = () => {
    if (busy || !input.current?.value) return
    const password = input.current.value
    input.current.value = ''
    onSubmit(password)
  }
  return (
    <ConfirmationDialog
      title={tr('files.verifySudoPrivileges')}
      description={tr('files.enterTheSudoPasswordRequiredByTheServerToUse')}
      tone="warning"
      confirmLabel={tr('files.verifyAndEnter')}
      busy={busy}
      busyLabel={tr('files.verifying')}
      error={renderMessage(error)}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <label className="field">
        <span>{tr('files.sudoPassword')}</span>
        <input ref={input} type="password" autoComplete="off" disabled={busy}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit() }
          }}
        />
      </label>
    </ConfirmationDialog>
  )
}
