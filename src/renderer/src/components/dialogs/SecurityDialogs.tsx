import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { ShieldCheck } from 'lucide-react'
import ConfirmationDialog from '../ConfirmationDialog'
import type { DialogLayerProps } from './types'

export function SecurityDialogs(props: Pick<DialogLayerProps, "pendingHostKey" | "pendingAliasHostKey" | "aliasOverwriteConfirmation" | "aliasDeleteConfirmation" | "aliasOperationBusy" | "onTrustHostKey" | "onDismissHostKey" | "onTrustAliasHostKey" | "onDismissAliasHostKey" | "onConfirmAliasOverwrite" | "onCancelAliasOverwrite" | "onConfirmAliasDelete" | "onCancelAliasDelete">) {
  useLanguage()
  const { pendingHostKey, pendingAliasHostKey, aliasOverwriteConfirmation, aliasDeleteConfirmation, aliasOperationBusy, onTrustHostKey, onDismissHostKey, onTrustAliasHostKey, onDismissAliasHostKey, onConfirmAliasOverwrite, onCancelAliasOverwrite, onConfirmAliasDelete, onCancelAliasDelete } = props
  const visibleHostKey = pendingHostKey ?? pendingAliasHostKey
  const aliasHostKeyVisible = !pendingHostKey && Boolean(pendingAliasHostKey)
  return (
    <>
      {visibleHostKey && (
              <div className="modal-backdrop">
                <section className="modal fingerprint-modal" role="dialog" aria-modal="true" aria-labelledby="fingerprint-title">
                  <div className="fingerprint-icon"><ShieldCheck size={24} /></div>
                  <div className="modal-kicker centered">{tr('connections.serverIdentityVerification')}</div>
                  <h2 id="fingerprint-title">{visibleHostKey.previousFingerprint ? tr('connections.serverFingerprintChanged') : tr('connections.verifyServerFingerprint')}</h2>
                  <p className="fingerprint-host">{visibleHostKey.profile.username}@{visibleHostKey.profile.host}:{visibleHostKey.profile.port}</p>
                  {visibleHostKey.previousFingerprint && (
                    <div className="fingerprint-compare">
                      <span>{tr('connections.saved')}</span><code>{visibleHostKey.previousFingerprint}</code>
                    </div>
                  )}
                  <div className="fingerprint-compare new-fingerprint">
                    <span>{tr('connections.currentFingerprint')}</span><code>{visibleHostKey.fingerprint}</code>
                  </div>
                  <p className="fingerprint-note">{tr('connections.verifyThisFingerprintWithTheServerAdministratorBeforeContinuing')}</p>
                  <div className="modal-footer">
                    <button className="secondary-button" onClick={aliasHostKeyVisible ? onDismissAliasHostKey : onDismissHostKey}>{tr('common.cancel')}</button>
                    <button className="primary-button" onClick={aliasHostKeyVisible ? onTrustAliasHostKey : onTrustHostKey}>
                      <ShieldCheck size={15} /> {visibleHostKey.previousFingerprint ? tr('connections.updateAndRetry') : tr('connections.trustAndRetry')}
                    </button>
                  </div>
                </section>
              </div>
            )}
      {aliasOverwriteConfirmation && (
              <ConfirmationDialog
                eyebrow={tr('connections.commandAliasConflict')}
                title={tr('connections.overwrite', { "name": aliasOverwriteConfirmation.name })}
                details={[
                  { label: tr('connections.currentCommand'), value: aliasOverwriteConfirmation.existingCommand },
                  { label: tr('connections.newCommand'), value: aliasOverwriteConfirmation.command ?? '' },
                ]}
                description={tr('connections.thisReplacesTheAliasInTheServerSBashrcThe')}
                tone="warning"
                confirmLabel={tr('connections.overwriteAlias')}
                busyLabel={tr('connections.writing')}
                busy={aliasOperationBusy}
                onConfirm={onConfirmAliasOverwrite}
                onCancel={onCancelAliasOverwrite}
              />
            )}
      {aliasDeleteConfirmation && (
              <ConfirmationDialog
                eyebrow={tr('connections.deleteCommandAlias')}
                title={tr('connections.delete', { "name": aliasDeleteConfirmation.name })}
                details={[
                  { label: tr('connections.actualCommand'), value: aliasDeleteConfirmation.existingCommand },
                ]}
                description={tr('connections.thisRemovesTheAliasFromTheServerSBashrcThe')}
                tone="danger"
                confirmLabel={tr('connections.deleteAlias')}
                busyLabel={tr('common.deleting')}
                busy={aliasOperationBusy}
                onConfirm={onConfirmAliasDelete}
                onCancel={onCancelAliasDelete}
              />
            )}
    </>
  )
}
