import { ChevronRight, FolderOpen, LayoutGrid, List, LoaderCircle, Monitor, Moon, Plus, RefreshCw, Sun, Terminal, Trash2, X } from 'lucide-react'
import type { CommandAlias, CommandAliasSnapshot, FileTypeCategory, ServerProfile, ThemeMode } from '@shared/types'
import { fileTypeRegistry } from '@shared/file-type-registry'
import type { PerformanceThresholdField } from '@/app-types'
import type { DialogLayerProps } from './types'
import FileTypeCategoryEditor from './FileTypeCategoryEditor'
import { previewLimitFields } from '@/app-utils'

const performanceThresholdFields: Array<{
  label: string
  warning: PerformanceThresholdField
  critical: PerformanceThresholdField
  unit: string
  step: string
}> = [
  { label: 'CPU 使用率', warning: 'cpuWarning', critical: 'cpuCritical', unit: '%', step: '1' },
  { label: '内存使用率', warning: 'memoryWarning', critical: 'memoryCritical', unit: '%', step: '1' },
  { label: '根分区使用率', warning: 'diskWarning', critical: 'diskCritical', unit: '%', step: '1' },
  { label: '每核 1 分钟负载', warning: 'loadPerCoreWarning', critical: 'loadPerCoreCritical', unit: '', step: '0.1' },
]

export function SettingsDialog(props: Pick<DialogLayerProps, "settingsForm" | "profiles" | "aliasSnapshot" | "aliasProfileId" | "aliasOperationBusy" | "aliasName" | "aliasCommand" | "onCloseSettings" | "onUpdateSettings" | "onAddFileTypeExtension" | "onRemoveFileTypeExtension" | "onResetFileTypeExtensions" | "onUpdateDefaultView" | "onUpdateTheme" | "onUpdateStartupProfile" | "onUpdateStartupKind" | "onSelectAliasProfile" | "onUpdateAliasName" | "onUpdateAliasCommand" | "onSyncAliases" | "onAddAlias" | "onRequestAliasDelete">) {
  const { settingsForm, profiles, aliasSnapshot, aliasProfileId, aliasOperationBusy, aliasName, aliasCommand, onCloseSettings, onUpdateSettings, onAddFileTypeExtension, onRemoveFileTypeExtension, onResetFileTypeExtensions, onUpdateDefaultView, onUpdateTheme, onUpdateStartupProfile, onUpdateStartupKind, onSelectAliasProfile, onUpdateAliasName, onUpdateAliasCommand, onSyncAliases, onAddAlias, onRequestAliasDelete } = props
  const invalidPerformanceThresholds = Boolean(settingsForm && performanceThresholdFields.some(({ warning, critical }) => {
    const warningText = settingsForm.performanceThresholds[warning]
    const criticalText = settingsForm.performanceThresholds[critical]
    const warningValue = Number(warningText)
    const criticalValue = Number(criticalText)
    return !warningText.trim() || !criticalText.trim()
      || !Number.isFinite(warningValue) || !Number.isFinite(criticalValue)
      || warningValue < 0 || criticalValue > 100 || warningValue >= criticalValue
  }))
  const sampleInterval = Number(settingsForm?.performanceSampleIntervalSeconds)
  const invalidPerformanceSampleInterval = Boolean(settingsForm && (!settingsForm.performanceSampleIntervalSeconds.trim()
    || !Number.isInteger(sampleInterval) || sampleInterval < 1 || sampleInterval > 300))
  return (
    <>
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
                    <fieldset className="settings-section settings-section-performance">
                      <legend>性能监控</legend>
                      <label className="field settings-performance-interval">
                        <span>采样间隔（秒）</span>
                        <input
                          required
                          type="number"
                          min="1"
                          max="300"
                          step="1"
                          value={settingsForm.performanceSampleIntervalSeconds}
                          onChange={(event) => onUpdateSettings('performanceSampleIntervalSeconds', event.target.value)}
                        />
                      </label>
                      {invalidPerformanceSampleInterval && <p className="settings-performance-error" role="alert">采样间隔必须是 1 到 300 秒之间的整数。</p>}
                      <div className="settings-performance-grid">
                        {performanceThresholdFields.map(({ label, warning, critical, unit, step }) => (
                          <div className="settings-performance-row" key={warning}>
                            <span>{label}</span>
                            <label>
                              <span>注意{unit ? `（${unit}）` : ''}</span>
                              <input required type="number" min="0" max="100" step={step} value={settingsForm.performanceThresholds[warning]} onChange={(event) => onUpdateSettings(warning, event.target.value)} />
                            </label>
                            <label>
                              <span>严重{unit ? `（${unit}）` : ''}</span>
                              <input required type="number" min="0" max="100" step={step} value={settingsForm.performanceThresholds[critical]} onChange={(event) => onUpdateSettings(critical, event.target.value)} />
                            </label>
                          </div>
                        ))}
                      </div>
                      {invalidPerformanceThresholds && <p className="settings-performance-error" role="alert">每项阈值必须在 0 到 100 之间，且注意值小于严重值。</p>}
                    </fieldset>
                    <details className="settings-section settings-section-file-types" aria-labelledby="file-type-categories-title">
                      <summary className="settings-disclosure-summary">
                        <h3 id="file-type-categories-title">文件类型分类</h3>
                        <ChevronRight className="settings-disclosure-chevron" size={15} />
                      </summary>
                      <div className="file-type-categories-content">
                        <div className="file-type-categories-heading">
                        <button type="button" className="text-button" onClick={onResetFileTypeExtensions}>恢复默认</button>
                        </div>
                        {fileTypeRegistry.map((definition) => (
                          <FileTypeCategoryEditor
                            key={definition.id}
                            category={definition.id}
                            label={definition.label}
                            capabilityDescription={definition.capabilityDescription}
                            extensions={settingsForm.fileTypeExtensions[definition.id]}
                            onAdd={onAddFileTypeExtension}
                            onRemove={onRemoveFileTypeExtension}
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
                        <ChevronRight className="settings-disclosure-chevron" size={15} />
                      </summary>
                      <div className="command-alias-control-row">
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
                        <div className="command-alias-toolbar-copy">
                          <span>{aliasSnapshot?.aliases.length ?? 0} 个别名</span>
                          <span className={'command-alias-status ' + (aliasSnapshot?.status ?? 'unsynced')}>
                            {aliasSnapshot?.status === 'synced'
                              ? `已同步 · ${aliasSnapshot.syncedAt ? new Date(aliasSnapshot.syncedAt).toLocaleString() : ''}`
                              : aliasSnapshot?.status === 'stale'
                                ? `待重新同步${aliasSnapshot.syncedAt ? ` · ${new Date(aliasSnapshot.syncedAt).toLocaleString()}` : ''}`
                                : '未同步'}
                          </span>
                        </div>
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
                        <button type="button" className="primary-button command-alias-add" disabled={aliasOperationBusy || !aliasProfileId || aliasSnapshot?.status !== 'synced'} onClick={onAddAlias} title="新增 alias 命令" aria-label="新增 alias 命令"><Plus size={15} />新增</button>
                      </div>
                      <p className="command-alias-note">仅支持 Bash。新增和删除会修改服务器的 ~/.bashrc，并在新开的终端中生效。</p>
                    </details>
                  </div>
                </section>
              </div>
            )}
    </>
  )
}
