import { ShieldCheck } from 'lucide-react'
import type { CommandAlias } from '@shared/types'
import ConfirmationDialog from '../ConfirmationDialog'
import type { DialogLayerProps } from './types'

export function SecurityDialogs(props: Pick<DialogLayerProps, "pendingHostKey" | "pendingAliasHostKey" | "aliasOverwriteConfirmation" | "aliasDeleteConfirmation" | "aliasOperationBusy" | "onTrustHostKey" | "onDismissHostKey" | "onTrustAliasHostKey" | "onDismissAliasHostKey" | "onConfirmAliasOverwrite" | "onCancelAliasOverwrite" | "onConfirmAliasDelete" | "onCancelAliasDelete">) {
  const { pendingHostKey, pendingAliasHostKey, aliasOverwriteConfirmation, aliasDeleteConfirmation, aliasOperationBusy, onTrustHostKey, onDismissHostKey, onTrustAliasHostKey, onDismissAliasHostKey, onConfirmAliasOverwrite, onCancelAliasOverwrite, onConfirmAliasDelete, onCancelAliasDelete } = props
  const visibleHostKey = pendingHostKey ?? pendingAliasHostKey
  const aliasHostKeyVisible = !pendingHostKey && Boolean(pendingAliasHostKey)
  return (
    <>
      {visibleHostKey && (
              <div className="modal-backdrop">
                <section className="modal fingerprint-modal" role="dialog" aria-modal="true" aria-labelledby="fingerprint-title">
                  <div className="fingerprint-icon"><ShieldCheck size={24} /></div>
                  <div className="modal-kicker centered">服务器身份校验</div>
                  <h2 id="fingerprint-title">{visibleHostKey.previousFingerprint ? '服务器指纹已变化' : '确认服务器指纹'}</h2>
                  <p className="fingerprint-host">{visibleHostKey.profile.username}@{visibleHostKey.profile.host}:{visibleHostKey.profile.port}</p>
                  {visibleHostKey.previousFingerprint && (
                    <div className="fingerprint-compare">
                      <span>已保存</span><code>{visibleHostKey.previousFingerprint}</code>
                    </div>
                  )}
                  <div className="fingerprint-compare new-fingerprint">
                    <span>当前指纹</span><code>{visibleHostKey.fingerprint}</code>
                  </div>
                  <p className="fingerprint-note">请与服务器管理员提供的指纹核对后再继续。</p>
                  <div className="modal-footer">
                    <button className="secondary-button" onClick={aliasHostKeyVisible ? onDismissAliasHostKey : onDismissHostKey}>取消</button>
                    <button className="primary-button" onClick={aliasHostKeyVisible ? onTrustAliasHostKey : onTrustHostKey}>
                      <ShieldCheck size={15} /> {visibleHostKey.previousFingerprint ? '更新并重试' : '信任并重试'}
                    </button>
                  </div>
                </section>
              </div>
            )}
      {aliasOverwriteConfirmation && (
              <ConfirmationDialog
                eyebrow="命令别名冲突"
                title={`覆盖 ${aliasOverwriteConfirmation.name}？`}
                details={[
                  { label: '当前命令', value: aliasOverwriteConfirmation.existingCommand },
                  { label: '新命令', value: aliasOverwriteConfirmation.command },
                ]}
                description="确认后会替换 ~/.bashrc 中唯一且完全匹配的定义；若无法安全定位，服务器文件不会修改。"
                tone="warning"
                confirmLabel="覆盖别名"
                busyLabel="正在写入"
                busy={aliasOperationBusy}
                onConfirm={onConfirmAliasOverwrite}
                onCancel={onCancelAliasOverwrite}
              />
            )}
      {aliasDeleteConfirmation && (
              <ConfirmationDialog
                eyebrow="删除命令别名"
                title={`删除 ${aliasDeleteConfirmation.name}？`}
                details={[{ label: '实际命令', value: aliasDeleteConfirmation.command }]}
                description="将从 ~/.bashrc 删除唯一且完全匹配的定义。此更改会在新开的终端中生效。"
                tone="danger"
                confirmLabel="删除别名"
                busyLabel="正在删除"
                busy={aliasOperationBusy}
                onConfirm={onConfirmAliasDelete}
                onCancel={onCancelAliasDelete}
              />
            )}
    </>
  )
}
