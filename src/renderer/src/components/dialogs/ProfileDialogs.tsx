import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { Check, KeyRound, Server, ShieldCheck, X } from 'lucide-react'
import ConfirmationDialog from '../ConfirmationDialog'
import type { DialogLayerProps } from './types'

export function ProfileDialogs(props: Pick<DialogLayerProps, "profileDialog" | "profileDeleteDialog" | "profileDeleteError" | "profileDeleting" | "onCloseProfile" | "onCloseProfileDelete" | "onConfirmProfileDelete" | "onUpdateProfile" | "onSubmitProfile">) {
  useLanguage()
  const { profileDialog, profileDeleteDialog, profileDeleteError, profileDeleting, onCloseProfile, onCloseProfileDelete, onConfirmProfileDelete, onUpdateProfile, onSubmitProfile } = props
  return (
    <>
      {profileDialog && (
              <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCloseProfile()}>
                <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
                  <div className="modal-heading">
                    <div>
                      <div className="modal-kicker"><Server size={14} /> SSH</div>
                      <h2 id="profile-modal-title">{profileDialog.mode === 'create' ? tr('connections.addServer') : tr('connections.editServer')}</h2>
                    </div>
                    <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} onClick={onCloseProfile}><X size={18} /></button>
                  </div>
                  <form onSubmit={onSubmitProfile}>
                    <label className="field">
                      <span>{tr('connections.connectionName')}</span>
                      <input autoFocus required value={profileDialog.form.name} onChange={(event) => onUpdateProfile({ name: event.target.value })} placeholder={tr('connections.eGProduction')} />
                    </label>
                    <div className="field-row">
                      <label className="field host-field">
                        <span>{tr('connections.hostAddress')}</span>
                        <input required value={profileDialog.form.host} onChange={(event) => onUpdateProfile({ host: event.target.value })} placeholder={tr('connections.ipAddressOrDomainName')} autoCapitalize="none" />
                      </label>
                      <label className="field port-field">
                        <span>{tr('connections.port')}</span>
                        <input required type="number" min="1" max="65535" value={profileDialog.form.port} onChange={(event) => onUpdateProfile({ port: event.target.value })} />
                      </label>
                    </div>
                    <label className="field">
                      <span>{tr('connections.username')}</span>
                      <input required value={profileDialog.form.username} onChange={(event) => onUpdateProfile({ username: event.target.value })} placeholder={tr('connections.serverLoginUsername')} autoCapitalize="none" />
                    </label>
                    <label className="field">
                      <span>{tr('connections.sshPassword')}</span>
                      <div className="password-input-wrap">
                        <KeyRound size={15} />
                        <input required={profileDialog.mode === 'create'} type="password" autoComplete="new-password" value={profileDialog.form.password} onChange={(event) => onUpdateProfile({ password: event.target.value })} placeholder={profileDialog.mode === 'edit' ? tr('connections.leaveEmptyToKeepTheCurrentPassword') : tr('connections.enterLoginPassword')} />
                      </div>
                    </label>
                    <div className="credential-hint"><ShieldCheck size={14} />{tr('connections.windowsEncryptsThePasswordAndStoresItOnThisComputer')}</div>
                    <div className="modal-footer">
                      <button type="button" className="secondary-button" onClick={onCloseProfile}>{tr('common.cancel')}</button>
                      <button type="submit" className="primary-button"><Check size={15} />{tr('connections.saveConnection')}</button>
                    </div>
                  </form>
                </section>
              </div>
            )}
      {profileDeleteDialog && (
              <ConfirmationDialog
                eyebrow={tr('connections.deleteConnection')}
                title={tr('connections.deleteConnectionConfiguration')}
                details={[
                  { label: tr('connections.connectionName'), value: profileDeleteDialog.name },
                  { label: tr('connections.connectionAddress'), value: `${profileDeleteDialog.username}@${profileDeleteDialog.host}:${profileDeleteDialog.port}` },
                ]}
                description={tr('connections.theConnectionDetailsAndPasswordSavedOnThisDeviceWill')}
                tone="danger"
                confirmLabel={tr('connections.deleteConnection')}
                busyLabel={tr('common.deleting')}
                error={profileDeleteError}
                errorLabel={tr('common.deletionFailed')}
                busy={profileDeleting}
                onConfirm={onConfirmProfileDelete}
                onCancel={onCloseProfileDelete}
              />
            )}
    </>
  )
}
