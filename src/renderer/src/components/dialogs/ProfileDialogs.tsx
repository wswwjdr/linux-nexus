import { Check, KeyRound, Server, ShieldCheck, X } from 'lucide-react'
import ConfirmationDialog from '../ConfirmationDialog'
import type { DialogLayerProps } from './types'

export function ProfileDialogs(props: Pick<DialogLayerProps, "profileDialog" | "profileDeleteDialog" | "profileDeleteError" | "profileDeleting" | "onCloseProfile" | "onCloseProfileDelete" | "onConfirmProfileDelete" | "onUpdateProfile" | "onSubmitProfile">) {
  const { profileDialog, profileDeleteDialog, profileDeleteError, profileDeleting, onCloseProfile, onCloseProfileDelete, onConfirmProfileDelete, onUpdateProfile, onSubmitProfile } = props
  return (
    <>
      {profileDialog && (
              <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCloseProfile()}>
                <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
                  <div className="modal-heading">
                    <div>
                      <div className="modal-kicker"><Server size={14} /> SSH</div>
                      <h2 id="profile-modal-title">{profileDialog.mode === 'create' ? '添加服务器' : '编辑服务器'}</h2>
                    </div>
                    <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onCloseProfile}><X size={18} /></button>
                  </div>
                  <form onSubmit={onSubmitProfile}>
                    <label className="field">
                      <span>连接名称</span>
                      <input autoFocus required value={profileDialog.form.name} onChange={(event) => onUpdateProfile({ name: event.target.value })} placeholder="例如：生产环境" />
                    </label>
                    <div className="field-row">
                      <label className="field host-field">
                        <span>主机地址</span>
                        <input required value={profileDialog.form.host} onChange={(event) => onUpdateProfile({ host: event.target.value })} placeholder="IP 地址或域名" autoCapitalize="none" />
                      </label>
                      <label className="field port-field">
                        <span>端口</span>
                        <input required type="number" min="1" max="65535" value={profileDialog.form.port} onChange={(event) => onUpdateProfile({ port: event.target.value })} />
                      </label>
                    </div>
                    <label className="field">
                      <span>用户名</span>
                      <input required value={profileDialog.form.username} onChange={(event) => onUpdateProfile({ username: event.target.value })} placeholder="Ubuntu 用户名" autoCapitalize="none" />
                    </label>
                    <label className="field">
                      <span>SSH 密码</span>
                      <div className="password-input-wrap">
                        <KeyRound size={15} />
                        <input required={profileDialog.mode === 'create'} type="password" autoComplete="new-password" value={profileDialog.form.password} onChange={(event) => onUpdateProfile({ password: event.target.value })} placeholder={profileDialog.mode === 'edit' ? '留空以保留当前密码' : '输入登录密码'} />
                      </div>
                    </label>
                    <div className="credential-hint"><ShieldCheck size={14} /> 密码将由 Windows 加密保存在此电脑</div>
                    <div className="modal-footer">
                      <button type="button" className="secondary-button" onClick={onCloseProfile}>取消</button>
                      <button type="submit" className="primary-button"><Check size={15} /> 保存连接</button>
                    </div>
                  </form>
                </section>
              </div>
            )}
      {profileDeleteDialog && (
              <ConfirmationDialog
                eyebrow="删除连接"
                title="删除连接配置？"
                details={[
                  { label: '连接名称', value: profileDeleteDialog.name },
                  { label: '连接地址', value: `${profileDeleteDialog.username}@${profileDeleteDialog.host}:${profileDeleteDialog.port}` },
                ]}
                description="删除后，此设备保存的连接配置和密码将被移除，对应会话也会断开。远程服务器上的文件不会受影响。"
                tone="danger"
                confirmLabel="删除连接"
                busyLabel="正在删除"
                error={profileDeleteError}
                errorLabel="删除失败"
                busy={profileDeleting}
                onConfirm={onConfirmProfileDelete}
                onCancel={onCloseProfileDelete}
              />
            )}
    </>
  )
}
