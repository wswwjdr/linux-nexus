import { useEffect, useState, type FormEvent } from 'react'
import { Check, ChevronRight, FolderOpen, KeyRound, LayoutGrid, List, LoaderCircle, Monitor, Moon, Plus, RefreshCw, Server, ShieldCheck, Sun, Terminal, Trash2, X } from 'lucide-react'
import type { CommandAlias, CommandAliasSnapshot, PreviewType, ServerProfile, ThemeMode } from '@shared/types'
import { normalizePreviewExtension, previewTypeLabels, previewTypes } from '@shared/preview-file-type'
import ConfirmationDialog from './ConfirmationDialog'
import LogPreviewDialog, { type LogPreviewDialogProps } from './previews/LogPreviewDialog'
import PreviewDialog, { type PreviewDialogProps } from './previews/PreviewDialog'
import type {
  FileViewMode,
  PendingHostKey,
  PendingAliasHostKey,
  ProfileForm,
  SettingsFieldKey,
  SettingsForm,
} from '@/app-types'
import { previewLimitFields } from '@/app-utils'

interface DialogLayerProps extends PreviewDialogProps, LogPreviewDialogProps {
  profileDialog: { mode: 'create' | 'edit'; form: ProfileForm } | null
  profileDeleteDialog: ServerProfile | null
  profileDeleteError: string | null
  profileDeleting: boolean
  createDirectoryDialog: { name: string } | null
  creatingDirectory: boolean
  settingsForm: SettingsForm | null
  profiles: ServerProfile[]
  textSaveError: string | null
  pendingHostKey: PendingHostKey | null
  pendingAliasHostKey: PendingAliasHostKey | null
  aliasSnapshot: CommandAliasSnapshot | null
  aliasProfileId: string
  aliasOperationBusy: boolean
  aliasName: string
  aliasCommand: string
  aliasOverwriteConfirmation: { name: string; existingCommand: string; command: string } | null
  aliasDeleteConfirmation: CommandAlias | null
  onCloseProfile: () => void
  onCloseProfileDelete: () => void
  onConfirmProfileDelete: () => void
  onCloseCreateDirectory: () => void
  onUpdateCreateDirectoryName: (name: string) => void
  onSubmitCreateDirectory: (event: FormEvent<HTMLFormElement>) => void
  onUpdateProfile: (patch: Partial<ProfileForm>) => void
  onSubmitProfile: (event: FormEvent<HTMLFormElement>) => void
  onCloseSettings: () => void
  onUpdateSettings: (key: SettingsFieldKey, value: string) => void
  onAddPreviewExtension: (type: PreviewType, extension: string) => void
  onRemovePreviewExtension: (type: PreviewType, extension: string) => void
  onResetPreviewExtensions: () => void
  onUpdateDefaultView: (mode: FileViewMode) => void
  onUpdateTheme: (theme: ThemeMode) => void
  onUpdateStartupProfile: (profileId: string) => void
  onUpdateStartupKind: (kind: SettingsForm['startupKind']) => void
  onClosePreview: () => void
  onConfirmTextSave: () => void
  onCancelTextSave: () => void
  onTrustHostKey: () => void
  onDismissHostKey: () => void
  onSelectAliasProfile: (profileId: string) => void
  onUpdateAliasName: (name: string) => void
  onUpdateAliasCommand: (command: string) => void
  onSyncAliases: () => void
  onAddAlias: () => void
  onConfirmAliasOverwrite: () => void
  onCancelAliasOverwrite: () => void
  onRequestAliasDelete: (alias: CommandAlias) => void
  onConfirmAliasDelete: () => void
  onCancelAliasDelete: () => void
  onTrustAliasHostKey: () => void
  onDismissAliasHostKey: () => void
}

function PreviewExtensionEditor({
  type,
  extensions,
  onAdd,
  onRemove,
}: {
  type: PreviewType
  extensions: string[]
  onAdd: (type: PreviewType, extension: string) => void
  onRemove: (type: PreviewType, extension: string) => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    try {
      const extension = normalizePreviewExtension(draft)
      if (extensions.includes(extension)) {
        setError('此后缀已添加')
        return
      }
      onAdd(type, extension)
      setDraft('')
      setError(null)
    } catch {
      setError('请输入有效后缀，例如 .txt 或 .tar.gz')
    }
  }

  return (
    <div className="preview-extension-row">
      <div className="preview-extension-heading">
        <strong>{previewTypeLabels[type].replace('预览', '')}</strong>
        <div className="preview-extension-tags">
          {extensions.map((extension) => (
            <span className="preview-extension-tag" key={extension}>
              <code>{extension}</code>
              <button type="button" title={'移除 ' + extension} aria-label={'移除 ' + extension} onClick={() => onRemove(type, extension)}><X size={12} /></button>
            </span>
          ))}
        </div>
      </div>
      <div className="preview-extension-add">
        <input
          value={draft}
          aria-label={'添加' + previewTypeLabels[type].replace('预览', '') + '后缀'}
          placeholder="添加后缀，如 .txt"
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="icon-button" title="添加后缀" aria-label="添加后缀" disabled={!draft.trim()} onClick={add}><Plus size={15} /></button>
      </div>
      {error && <span className="preview-extension-error" role="alert">{error}</span>}
    </div>
  )
}

export default function DialogLayer({
  profileDialog,
  profileDeleteDialog,
  profileDeleteError,
  profileDeleting,
  createDirectoryDialog,
  creatingDirectory,
  settingsForm,
  profiles,
  previewDialog,
  logPreviewDialog,
  textDraft,
  textDirty,
  textSaving,
  textSaveConfirmation,
  textSaveError,
  pendingHostKey,
  pendingAliasHostKey,
  aliasSnapshot,
  aliasProfileId,
  aliasOperationBusy,
  aliasName,
  aliasCommand,
  aliasOverwriteConfirmation,
  aliasDeleteConfirmation,
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
  onAddPreviewExtension,
  onRemovePreviewExtension,
  onResetPreviewExtensions,
  onUpdateDefaultView,
  onUpdateTheme,
  onUpdateStartupProfile,
  onUpdateStartupKind,
  onClosePreview,
  onOpenExternalLink,
  onLogPreviewScroll,
  onUpdateTextDraft,
  onRequestTextSave,
  onConfirmTextSave,
  onCancelTextSave,
  onPreviewImageLoad,
  onZoomPreviewImage,
  onTrustHostKey,
  onDismissHostKey,
  onSelectAliasProfile,
  onUpdateAliasName,
  onUpdateAliasCommand,
  onSyncAliases,
  onAddAlias,
  onConfirmAliasOverwrite,
  onCancelAliasOverwrite,
  onRequestAliasDelete,
  onConfirmAliasDelete,
  onCancelAliasDelete,
  onTrustAliasHostKey,
  onDismissAliasHostKey,
}: DialogLayerProps) {
  const visibleHostKey = pendingHostKey ?? pendingAliasHostKey
  const aliasHostKeyVisible = !pendingHostKey && Boolean(pendingAliasHostKey)
  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (pendingHostKey || pendingAliasHostKey) {
        event.preventDefault()
        if (aliasHostKeyVisible) onDismissAliasHostKey()
        else onDismissHostKey()
        return
      }
      if (textSaveConfirmation) return
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
        if (!aliasOperationBusy) onCloseSettings()
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
    onDismissAliasHostKey,
    aliasHostKeyVisible,
    pendingHostKey,
    pendingAliasHostKey,
    previewDialog,
    logPreviewDialog,
    textSaveConfirmation,
    profileDialog,
    createDirectoryDialog,
    creatingDirectory,
    settingsForm,
    aliasOperationBusy,
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
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !aliasOperationBusy && onCloseSettings()}>
          <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
            <div className="modal-heading settings-modal-heading">
              <h2 id="settings-modal-title">应用设置</h2>
              <button className="icon-button modal-close" title="关闭" aria-label="关闭设置" disabled={aliasOperationBusy} onClick={onCloseSettings}><X size={18} /></button>
            </div>
            <div className="settings-form-content">
              <fieldset className="settings-section settings-section-appearance">
                <legend>外观</legend>
                <div className="settings-view-options settings-theme-options" role="group" aria-label="外观主题">
                  <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'light'} onClick={() => onUpdateTheme('light')}>
                    <Sun size={15} /> 亮色
                  </button>
                  <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'dark'} onClick={() => onUpdateTheme('dark')}>
                    <Moon size={15} /> 暗色
                  </button>
                  <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'system'} onClick={() => onUpdateTheme('system')}>
                    <Monitor size={15} /> 跟随系统
                  </button>
                </div>
              </fieldset>
              <fieldset className="settings-section settings-section-view">
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
              <fieldset className="settings-section settings-section-startup">
                <legend>启动连接</legend>
                <label className="field settings-startup-profile">
                  <span>启动时连接</span>
                  <select
                    value={settingsForm.startupProfileId}
                    onChange={(event) => onUpdateStartupProfile(event.target.value)}
                  >
                    <option value="">不自动连接（打开首页）</option>
                    {profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>
                        {profile.name}（{profile.username}@{profile.host}:{profile.port}）
                      </option>
                    ))}
                  </select>
                </label>
                {settingsForm.startupProfileId && (
                  <div className="settings-startup-kind">
                    <span className="settings-field-label">连接方式</span>
                    <div className="settings-view-options" role="group" aria-label="启动连接方式">
                      <button
                        type="button"
                        className="settings-view-option"
                        aria-pressed={settingsForm.startupKind === 'sftp'}
                        onClick={() => onUpdateStartupKind('sftp')}
                      >
                        <FolderOpen size={15} /> SFTP 文件管理
                      </button>
                      <button
                        type="button"
                        className="settings-view-option"
                        aria-pressed={settingsForm.startupKind === 'terminal'}
                        onClick={() => onUpdateStartupKind('terminal')}
                      >
                        <Terminal size={15} /> SSH 终端
                      </button>
                    </div>
                  </div>
                )}
              </fieldset>
              <fieldset className="settings-section settings-section-preview">
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
              <details className="settings-section settings-section-formats" aria-labelledby="preview-formats-title">
                <summary className="settings-disclosure-summary">
                  <h3 id="preview-formats-title">预览格式</h3>
                  <ChevronRight className="settings-disclosure-chevron" size={15} />
                </summary>
                <div className="preview-formats-content">
                  <div className="preview-formats-heading">
                  <button type="button" className="text-button" onClick={onResetPreviewExtensions}>恢复默认</button>
                  </div>
                  {previewTypes.map((type) => (
                    <PreviewExtensionEditor
                      key={type}
                      type={type}
                      extensions={settingsForm.previewExtensions[type]}
                      onAdd={onAddPreviewExtension}
                      onRemove={onRemovePreviewExtension}
                    />
                  ))}
                </div>
              </details>
              <fieldset className="settings-section settings-section-transfer">
                <legend>文件传输</legend>
                <label className="field settings-transfer-concurrency">
                  <span>同时传输文件数</span>
                  <input
                    required
                    type="number"
                    min="1"
                    max="16"
                    step="1"
                    value={settingsForm.transferFileConcurrency}
                    onChange={(event) => onUpdateSettings('transferFileConcurrency', event.target.value)}
                  />
                </label>
              </fieldset>
              <details className="settings-section settings-section-aliases command-aliases-field" aria-labelledby="command-aliases-title">
                <summary className="settings-disclosure-summary command-aliases-heading">
                  <h3 id="command-aliases-title">命令别名</h3>
                  <span className={'command-alias-status ' + (aliasSnapshot?.status ?? 'unsynced')}>
                    {aliasSnapshot?.status === 'synced'
                      ? `已同步 · ${aliasSnapshot.syncedAt ? new Date(aliasSnapshot.syncedAt).toLocaleString() : ''}`
                      : aliasSnapshot?.status === 'stale'
                        ? `待重新同步${aliasSnapshot.syncedAt ? ` · ${new Date(aliasSnapshot.syncedAt).toLocaleString()}` : ''}`
                        : '未同步'}
                  </span>
                  <ChevronRight className="settings-disclosure-chevron" size={15} />
                </summary>
                <label className="field command-alias-profile-field">
                  <span>服务器</span>
                  <select
                    value={aliasProfileId}
                    disabled={aliasOperationBusy || !profiles.length}
                    onChange={(event) => onSelectAliasProfile(event.target.value)}
                  >
                    {profiles.map((profile) => (
                      <option value={profile.id} key={profile.id}>{profile.name}（{profile.username}@{profile.host}:{profile.port}）</option>
                    ))}
                  </select>
                </label>
                <div className="command-alias-toolbar">
                  <span>{aliasSnapshot?.aliases.length ?? 0} 个别名</span>
                  <button type="button" className="secondary-button command-alias-sync" disabled={aliasOperationBusy || !aliasProfileId} onClick={onSyncAliases}>
                    {aliasOperationBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                    {aliasOperationBusy ? '处理中' : aliasSnapshot?.status === 'synced' ? '重新同步' : '同步'}
                  </button>
                </div>
                <div className="command-alias-list">
                  {!aliasProfileId ? (
                    <div className="command-alias-empty">请先添加服务器连接</div>
                  ) : aliasSnapshot?.aliases.length ? aliasSnapshot.aliases.map((alias) => (
                    <div className="command-alias-row" key={alias.name}>
                      <div className="command-alias-copy">
                        <code>{alias.name}</code>
                        <span>{alias.command}</span>
                        {!alias.removable && <small>{alias.removalReason}</small>}
                      </div>
                      <button
                        type="button"
                        className="icon-button command-alias-delete"
                        title={alias.removable ? `删除 ${alias.name}` : alias.removalReason ?? '此别名无法安全删除'}
                        aria-label={alias.removable ? `删除 ${alias.name}` : `${alias.name}：${alias.removalReason ?? '无法安全删除'}`}
                        disabled={aliasOperationBusy || !alias.removable}
                        onClick={() => onRequestAliasDelete(alias)}
                      ><Trash2 size={14} /></button>
                    </div>
                  )) : (
                    <div className="command-alias-empty">{aliasSnapshot?.status === 'synced' ? '服务器当前没有 alias' : '尚未同步服务器别名'}</div>
                  )}
                </div>
                <div className="command-alias-add-row">
                  <label className="field">
                    <span>别名名称</span>
                    <input autoCapitalize="none" autoComplete="off" disabled={aliasOperationBusy || !aliasProfileId} value={aliasName} onChange={(event) => onUpdateAliasName(event.target.value)} placeholder="例如 ll" />
                  </label>
                  <label className="field">
                    <span>实际命令</span>
                    <input autoCapitalize="none" autoComplete="off" disabled={aliasOperationBusy || !aliasProfileId} value={aliasCommand} onChange={(event) => onUpdateAliasCommand(event.target.value)} placeholder="例如 ls -alF" />
                  </label>
                  <button type="button" className="primary-button command-alias-add" disabled={aliasOperationBusy || !aliasProfileId} onClick={onAddAlias} title="新增 alias 命令" aria-label="新增 alias 命令"><Plus size={15} />新增</button>
                </div>
                <p className="command-alias-note">仅支持 Bash。新增和删除会修改服务器的 ~/.bashrc，并在新开的终端中生效。</p>
              </details>
            </div>
          </section>
        </div>
      )}

      <PreviewDialog
        previewDialog={previewDialog}
        textDraft={textDraft}
        textDirty={textDirty}
        textSaving={textSaving}
        textSaveConfirmation={textSaveConfirmation}
        imageZoom={imageZoom}
        imagePreviewSize={imagePreviewSize}
        imageViewportRef={imageViewportRef}
        previewImageRef={previewImageRef}
        onClosePreview={onClosePreview}
        onOpenExternalLink={onOpenExternalLink}
        onUpdateTextDraft={onUpdateTextDraft}
        onRequestTextSave={onRequestTextSave}
        onPreviewImageLoad={onPreviewImageLoad}
        onZoomPreviewImage={onZoomPreviewImage}
      />

      <LogPreviewDialog
        logPreviewDialog={logPreviewDialog}
        logViewportRef={logViewportRef}
        onClosePreview={onClosePreview}
        onLogPreviewScroll={onLogPreviewScroll}
      />

      {textSaveConfirmation && (
        <ConfirmationDialog
          eyebrow="保存远程文件"
          title={`覆盖 ${textSaveConfirmation.name}？`}
          details={[
            { label: '远程路径', value: textSaveConfirmation.path },
          ]}
          description="确认后将以当前编辑内容覆盖服务器上的源文件。保存前会检查该文件是否已被其他人修改。"
          tone="warning"
          confirmLabel="覆盖并保存"
          busyLabel="正在保存"
          error={textSaveError}
          errorLabel="保存失败"
          busy={textSaving}
          onConfirm={onConfirmTextSave}
          onCancel={onCancelTextSave}
        />
      )}

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
