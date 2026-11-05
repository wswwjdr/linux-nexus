import { useState } from 'react'
import type { TextSavePackage } from '@shared/types'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface TextSaveInstallDialogProps {
  path: string
  packages: TextSavePackage[]
  passwordRequired: boolean
  busy: boolean
  error: string | null
  onConfirm: (password?: string) => void
  onCancel: () => void
}

export default function TextSaveInstallDialog({ path, packages, passwordRequired, busy, error, onConfirm, onCancel }: TextSaveInstallDialogProps) {
  const [password, setPassword] = useState('')
  const confirm = () => {
    if (busy || (passwordRequired && !password)) return
    onConfirm(passwordRequired ? password : undefined)
    setPassword('')
  }

  return (
    <ConfirmationDialog
      eyebrow="保存远程文件"
      title={passwordRequired ? '验证远程 sudo 权限' : '安装远程保存依赖？'}
      description={passwordRequired ? '远程服务器要求验证 sudo 密码。安装成功后将继续保存当前草稿。' : '保存需要这些软件包来验证文件元数据。确认后将在远程服务器安装，并继续保存当前草稿。'}
      details={[{ label: '远程路径', value: path }, { label: '软件包', value: packages.join('、') }]}
      tone="warning"
      confirmLabel={passwordRequired ? '验证并安装' : '安装并继续保存'}
      confirmDisabled={passwordRequired && !password}
      focusCancel={!passwordRequired}
      busyLabel="正在安装"
      busy={busy}
      error={error}
      errorLabel="安装失败"
      onConfirm={confirm}
      onCancel={onCancel}
    >
      {passwordRequired && (
        <label className="field confirmation-field">
          <span>sudo 密码</span>
          <input type="password" autoComplete="off" autoFocus value={password} disabled={busy}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) confirm() }}
          />
        </label>
      )}
    </ConfirmationDialog>
  )
}
