import { useEffect, type FormEvent, type KeyboardEvent, type RefObject, type SyntheticEvent, type WheelEvent } from 'react'
import { Check, Eye, FileText, FolderPlus, KeyRound, LayoutGrid, List, LoaderCircle, Server, ShieldCheck, X } from 'lucide-react'
import type { ServerProfile } from '@shared/types'
import ConfirmationDialog from './ConfirmationDialog'
import type {
  FileViewMode,
  ImagePreviewSize,
  LogPreviewDialog as LogPreviewDialogState,
  PendingHostKey,
  PreviewDialog as PreviewDialogState,
  PreviewLimitKey,
  ProfileForm,
  SettingsForm,
} from '@/app-types'
import { previewLimitFields } from '@/app-utils'

interface DialogLayerProps {
  profileDialog: { mode: 'create' | 'edit'; form: ProfileForm } | null
  profileDeleteDialog: ServerProfile | null
  profileDeleteError: string | null
  profileDeleting: boolean
  createDirectoryDialog: { name: string } | null
  creatingDirectory: boolean
  settingsForm: SettingsForm | null
  settingsSaving: boolean
  previewDialog: PreviewDialogState | null
  logPreviewDialog: LogPreviewDialogState | null
  pendingHostKey: PendingHostKey | null
  imageZoom: number
  imagePreviewSize: ImagePreviewSize | null
  imageViewportRef: RefObject<HTMLDivElement | null>
  previewImageRef: RefObject<HTMLImageElement | null>
  logViewportRef: RefObject<HTMLPreElement | null>
  onCloseProfile: () => void
  onCloseProfileDelete: () => void
  onConfirmProfileDelete: () => void
  onCloseCreateDirectory: () => void
  onUpdateCreateDirectoryName: (name: string) => void
  onSubmitCreateDirectory: (event: FormEvent<HTMLFormElement>) => void
  onUpdateProfile: (patch: Partial<ProfileForm>) => void
  onSubmitProfile: (event: FormEvent<HTMLFormElement>) => void
  onCloseSettings: () => void
  onUpdateSettings: (key: PreviewLimitKey, value: string) => void
  onUpdateDefaultView: (mode: FileViewMode) => void
  onSubmitSettings: (event: FormEvent<HTMLFormElement>) => void
  onClosePreview: () => void
  onLogPreviewScroll: () => void
  onPreviewImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onZoomPreviewImage: (event: WheelEvent<HTMLDivElement>) => void
  onTrustHostKey: () => void
  onDismissHostKey: () => void
}

export default function DialogLayer({
  profileDialog,
  profileDeleteDialog,
  profileDeleteError,
  profileDeleting,
  createDirectoryDialog,
  creatingDirectory,
  settingsForm,
  settingsSaving,
  previewDialog,
  logPreviewDialog,
  pendingHostKey,
  imageZoom,
  imagePreviewSize,
  imageViewportRef,
  previewImageRef,
  logViewportRef,
  onCloseProfile,
  onCloseProfileDelete,
  onConfirmProfileDelete,
  onCloseCreateDirectory,
  onUpdateCreateDirectoryName,
  onSubmitCreateDirectory,
  onUpdateProfile,
  onSubmitProfile,
  onCloseSettings,
  onUpdateSettings,
  onUpdateDefaultView,
  onSubmitSettings,
  onClosePreview,
  onLogPreviewScroll,
  onPreviewImageLoad,
  onZoomPreviewImage,
  onTrustHostKey,
  onDismissHostKey,
}: DialogLayerProps) {
  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (pendingHostKey) {
        event.preventDefault()
        onDismissHostKey()
        return
      }
      if (previewDialog) {
        event.preventDefault()
        onClosePreview()
        return
      }
      if (logPreviewDialog) {
        event.preventDefault()
        onClosePreview()
        return
      }
      if (createDirectoryDialog) {
        event.preventDefault()
        if (!creatingDirectory) onCloseCreateDirectory()
        return
      }
      if (settingsForm) {
        event.preventDefault()
        if (!settingsSaving) onCloseSettings()
        return
      }
      if (profileDialog) {
        event.preventDefault()
        onCloseProfile()
      }
    }

    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [
    onClosePreview,
    onCloseProfile,
    onCloseCreateDirectory,
    onCloseSettings,
    onDismissHostKey,
    pendingHostKey,
    previewDialog,
    logPreviewDialog,
    profileDialog,
    createDirectoryDialog,
    creatingDirectory,
    settingsForm,
    settingsSaving,
  ])

  return (
    <>
      {profileDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCloseProfile()}>
          <section className="modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><Server size={14} /> SSH / SFTP</div>
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

      {createDirectoryDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !creatingDirectory && onCloseCreateDirectory()}>
          <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="create-directory-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><FolderPlus size={14} /> 新建文件夹</div>
                <h2 id="create-directory-title">新建文件夹</h2>
              </div>
              <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={creatingDirectory} onClick={onCloseCreateDirectory}><X size={18} /></button>
            </div>
            <form onSubmit={onSubmitCreateDirectory}>
              <label className="field">
                <span>名称</span>
                <input
                  autoFocus
                  autoCapitalize="none"
                  autoComplete="off"
                  required
                  disabled={creatingDirectory}
                  value={createDirectoryDialog.name}
                  onChange={(event) => onUpdateCreateDirectoryName(event.target.value)}
                  placeholder="文件夹名称"
                />
              </label>
              <div className="modal-footer">
                <button type="button" className="secondary-button" disabled={creatingDirectory} onClick={onCloseCreateDirectory}>取消</button>
                <button type="submit" className="primary-button" disabled={creatingDirectory}>
                  {creatingDirectory ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
                  {creatingDirectory ? '创建中' : '创建'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {settingsForm && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !settingsSaving && onCloseSettings()}>
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="应用设置">
            <form onSubmit={onSubmitSettings}>
              <fieldset className="settings-view-field" disabled={settingsSaving}>
                <legend>默认文件视图</legend>
                <div className="settings-view-options" role="group" aria-label="默认文件视图">
                  <button
                    type="button"
                    className="settings-view-option"
                    aria-pressed={settingsForm.defaultView === 'icons'}
                    onClick={() => onUpdateDefaultView('icons')}
                  >
                    <LayoutGrid size={15} /> 图标视图
                  </button>
                  <button
                    type="button"
                    className="settings-view-option"
                    aria-pressed={settingsForm.defaultView === 'details'}
                    onClick={() => onUpdateDefaultView('details')}
                  >
                    <List size={16} /> 详细信息
                  </button>
                </div>
              </fieldset>
              <fieldset className="settings-preview-field">
                <legend>预览大小上限</legend>
                <div className="settings-preview-grid">
                  {previewLimitFields.map(({ key, label }) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input required type="number" min="1" max="1024" step="1" value={settingsForm[key]} onChange={(event) => onUpdateSettings(key, event.target.value)} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="modal-footer">
                <button type="button" className="secondary-button" disabled={settingsSaving} onClick={onCloseSettings}>取消</button>
                <button type="submit" className="primary-button" disabled={settingsSaving}><Check size={15} /> 保存设置</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {previewDialog && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClosePreview()}>
          <section className={'modal preview-modal ' + (previewDialog.kind === 'ready' ? 'media-preview-modal' : '')} role="dialog" aria-modal="true" aria-labelledby="preview-modal-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><Eye size={14} /> 文件预览</div>
                <h2 id="preview-modal-title">{previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name}</h2>
              </div>
              <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" onClick={onClosePreview}><X size={18} /></button>
            </div>
            {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取文件</div>}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'text' && (
              <pre className="preview-text">{previewDialog.result.content}</pre>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'image' && (
              <div className="preview-media image-preview-viewport" ref={imageViewportRef} onWheel={onZoomPreviewImage}>
                <div
                  className="preview-image-canvas"
                  style={{
                    width: Math.max(imageViewportRef.current?.clientWidth ?? 0, (imagePreviewSize?.width ?? 0) * imageZoom) + 'px',
                    height: Math.max(imageViewportRef.current?.clientHeight ?? 0, (imagePreviewSize?.height ?? 0) * imageZoom) + 'px',
                  }}
                >
                  <img
                    ref={previewImageRef}
                    className="preview-image"
                    src={previewDialog.result.url}
                    alt={previewDialog.result.name}
                    draggable={false}
                    style={imagePreviewSize
                      ? { width: imagePreviewSize.width * imageZoom + 'px', height: imagePreviewSize.height * imageZoom + 'px' }
                      : { maxWidth: '100%', maxHeight: '100%' }}
                    onLoad={onPreviewImageLoad}
                  />
                </div>
              </div>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'audio' && (
              <div className="preview-audio-wrap"><audio controls src={previewDialog.result.url}>浏览器不支持音频播放。</audio></div>
            )}
            {previewDialog.kind === 'ready' && previewDialog.result.type === 'video' && (
              <div className="preview-media">
                <video
                  className="preview-video"
                  controls
                  tabIndex={0}
                  src={previewDialog.result.url}
                  onKeyDown={(event: KeyboardEvent<HTMLVideoElement>) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    const video = event.currentTarget
                    const nextTime = Math.max(0, video.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
                    video.currentTime = Number.isFinite(video.duration) ? Math.min(video.duration, nextTime) : nextTime
                  }}
                >浏览器不支持视频播放。</video>
              </div>
            )}
          </section>
        </div>
      )}

      {logPreviewDialog && (
        <div className="modal-backdrop log-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClosePreview()}>
          <section className="modal preview-modal log-preview-modal" role="dialog" aria-modal="true" aria-labelledby="log-preview-title">
            <div className="modal-heading">
              <div>
                <div className="modal-kicker"><FileText size={14} /> 倒序预览</div>
                <h2 id="log-preview-title">{logPreviewDialog.name}</h2>
              </div>
              <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" onClick={onClosePreview}><X size={18} /></button>
            </div>
            {logPreviewDialog.kind === 'loading' && (
              <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取日志</div>
            )}
            {logPreviewDialog.kind === 'ready' && (
              <>
                <div className="log-preview-status" aria-live="polite">
                  {logPreviewDialog.loadingEarlier
                    ? <><LoaderCircle className="spin" size={14} /> 正在读取更早内容</>
                    : !logPreviewDialog.hasEarlier
                      ? logPreviewDialog.startOffset === 0 ? '已到文件开头' : '已达到文本预览上限'
                      : ''}
                </div>
                <pre ref={logViewportRef} className="preview-text log-preview-text" tabIndex={0} onScroll={onLogPreviewScroll}>{logPreviewDialog.content}</pre>
              </>
            )}
          </section>
        </div>
      )}

      {pendingHostKey && (
        <div className="modal-backdrop">
          <section className="modal fingerprint-modal" role="dialog" aria-modal="true" aria-labelledby="fingerprint-title">
            <div className="fingerprint-icon"><ShieldCheck size={24} /></div>
            <div className="modal-kicker centered">服务器身份校验</div>
            <h2 id="fingerprint-title">{pendingHostKey.previousFingerprint ? '服务器指纹已变化' : '确认服务器指纹'}</h2>
            <p className="fingerprint-host">{pendingHostKey.profile.username}@{pendingHostKey.profile.host}:{pendingHostKey.profile.port}</p>
            {pendingHostKey.previousFingerprint && (
              <div className="fingerprint-compare">
                <span>已保存</span><code>{pendingHostKey.previousFingerprint}</code>
              </div>
            )}
            <div className="fingerprint-compare new-fingerprint">
              <span>当前指纹</span><code>{pendingHostKey.fingerprint}</code>
            </div>
            <p className="fingerprint-note">请与服务器管理员提供的指纹核对后再继续。</p>
            <div className="modal-footer">
              <button className="secondary-button" onClick={onDismissHostKey}>取消</button>
              <button className="primary-button" onClick={onTrustHostKey}>
                <ShieldCheck size={15} /> {pendingHostKey.previousFingerprint ? '更新并重连' : '信任并重连'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
