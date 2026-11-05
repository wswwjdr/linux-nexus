import { useEffect, useRef } from 'react'
import ConfirmationDialog from '../ConfirmationDialog'

interface FileRootPasswordDialogProps {
  busy: boolean
  error?: string
  onSubmit: (password: string) => void
  onCancel: () => void
}

export default function FileRootPasswordDialog({ busy, error, onSubmit, onCancel }: FileRootPasswordDialogProps) {
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
      title="验证 sudo 权限"
      description="输入服务器要求的 sudo 密码，以 root 身份操作当前文件标签。"
      tone="warning"
      confirmLabel="验证并进入"
      busy={busy}
      busyLabel="正在验证"
      error={error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <label className="field">
        <span>sudo 密码</span>
        <input ref={input} type="password" autoComplete="off" disabled={busy}
          onKeyDown={(event) => {
            if (event.key === 'Enter') { event.preventDefault(); submit() }
          }}
        />
      </label>
    </ConfirmationDialog>
  )
}
