import { type MessageValue, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useState } from 'react'
import type { TextSavePackage } from '@shared/types'
import ConfirmationDialog from '@/components/ConfirmationDialog'

interface TextSaveInstallDialogProps {
  path: string
  packages: TextSavePackage[]
  passwordRequired: boolean
  busy: boolean
  error: MessageValue | null
  onConfirm: (password?: string) => void
  onCancel: () => void
}

export default function TextSaveInstallDialog({ path, packages, passwordRequired, busy, error, onConfirm, onCancel }: TextSaveInstallDialogProps) {
  useLanguage()
  const [password, setPassword] = useState('')
  const confirm = () => {
    if (busy || (passwordRequired && !password)) return
    onConfirm(passwordRequired ? password : undefined)
    setPassword('')
  }

  return (
    <ConfirmationDialog
      eyebrow={tr('previews.saveRemoteFile')}
      title={passwordRequired ? tr('previews.verifyRemoteSudoPrivileges') : tr('previews.installRemoteSaveDependencies')}
      description={passwordRequired ? tr('previews.theRemoteServerRequiresASudoPasswordSavingYourDraft') : tr('previews.thesePackagesAreRequiredToVerifyFileMetadataConfirmTo')}
      details={[{ label: tr('common.remotePath'), value: path }, { label: tr('previews.packages'), value: packages.join('、') }]}
      tone="warning"
      confirmLabel={passwordRequired ? tr('previews.verifyAndInstall') : tr('previews.installAndContinueSaving')}
      confirmDisabled={passwordRequired && !password}
      focusCancel={!passwordRequired}
      busyLabel={tr('previews.installing')}
      busy={busy}
      error={renderMessage(error)}
      errorLabel={tr('previews.installationFailed')}
      onConfirm={confirm}
      onCancel={onCancel}
    >
      {passwordRequired && (
        <label className="field confirmation-field">
          <span>{tr('files.sudoPassword')}</span>
          <input type="password" autoComplete="off" autoFocus value={password} disabled={busy}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) confirm() }}
          />
        </label>
      )}
    </ConfirmationDialog>
  )
}
