import { type MessageValue, formatLocale, msg, renderMessage, tr } from '@shared/i18n/messages'
import { languages, type LanguagePreference } from '@shared/i18n/languages'
import { useLanguage } from '@/i18n'
import { fileTypeMessages } from '@shared/preview-file-type'

import { ChevronRight, FolderOpen, LayoutGrid, List, LoaderCircle, Moon, Palette, Plus, RefreshCw, Sun, Terminal, Trash2, X } from 'lucide-react'
import type { CommandAlias, CommandAliasSnapshot, FileTypeCategory, ServerProfile, ThemeMode } from '@shared/types'
import { fileTypeRegistry } from '@shared/file-type-registry'
import type { PerformanceThresholdField } from '@/app-types'
import type { DialogLayerProps } from './types'
import FileTypeCategoryEditor from './FileTypeCategoryEditor'
import { previewLimitFields } from '@/app-utils'

const performanceThresholdFields: Array<{
  label: MessageValue
  warning: PerformanceThresholdField
  critical: PerformanceThresholdField
  unit: string
  step: string
}> = [
  { label: msg('settings.cpuUsage'), warning: 'cpuWarning', critical: 'cpuCritical', unit: '%', step: '1' },
  { label: msg('settings.memoryUsage'), warning: 'memoryWarning', critical: 'memoryCritical', unit: '%', step: '1' },
  { label: msg('settings.rootPartitionUsage'), warning: 'diskWarning', critical: 'diskCritical', unit: '%', step: '1' },
  { label: msg('settings.1MinuteLoadPerCore'), warning: 'loadPerCoreWarning', critical: 'loadPerCoreCritical', unit: '', step: '0.1' },
]

export function SettingsDialog(props: Pick<DialogLayerProps, "settingsForm" | "profiles" | "aliasSnapshot" | "aliasProfileId" | "aliasOperationBusy" | "aliasName" | "aliasCommand" | "onCloseSettings" | "onUpdateSettings" | "onAddFileTypeExtension" | "onRemoveFileTypeExtension" | "onResetFileTypeExtensions" | "onUpdateDefaultView" | "onUpdateLanguage" | "onUpdateTheme" | "onUpdateStartupProfile" | "onUpdateStartupKind" | "onSelectAliasProfile" | "onUpdateAliasName" | "onUpdateAliasCommand" | "onSyncAliases" | "onAddAlias" | "onRequestAliasDelete">) {
  useLanguage()
  const { settingsForm, profiles, aliasSnapshot, aliasProfileId, aliasOperationBusy, aliasName, aliasCommand, onCloseSettings, onUpdateSettings, onAddFileTypeExtension, onRemoveFileTypeExtension, onResetFileTypeExtensions, onUpdateDefaultView, onUpdateTheme, onUpdateLanguage, onUpdateStartupProfile, onUpdateStartupKind, onSelectAliasProfile, onUpdateAliasName, onUpdateAliasCommand, onSyncAliases, onAddAlias, onRequestAliasDelete } = props
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
                    <h2 id="settings-modal-title">{tr('settings.applicationSettings')}</h2>
                    <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('settings.closeSettings')} disabled={aliasOperationBusy} onClick={onCloseSettings}><X size={18} /></button>
                  </div>
                  <div className="settings-form-content">
                    <fieldset className="settings-section settings-section-language">
                      <legend>{tr('settings.language')}</legend>
                      <label className="field">
                        <span>{tr('settings.displayLanguage')}</span>
                        <select value={settingsForm.language} onChange={event => onUpdateLanguage(event.target.value as LanguagePreference)}>
                          <option value="system">{tr('settings.followSystem')}</option>
                          {Object.entries(languages).map(([id, language]) => <option key={id} value={id}>{language.name}</option>)}
                        </select>
                      </label>
                    </fieldset>
                    <fieldset className="settings-section settings-section-appearance">
                      <legend>{tr('settings.appearance')}</legend>
                      <div className="settings-view-options settings-theme-options" role="group" aria-label={tr('settings.appearanceTheme')}>
                        <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'light'} onClick={() => onUpdateTheme('light')}>
                          <Sun size={15} />{tr('settings.silver')}</button>
                        <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'dark'} onClick={() => onUpdateTheme('dark')}>
                          <Moon size={15} />{tr('settings.graphite')}</button>
                        <button type="button" className="settings-view-option" aria-pressed={settingsForm.theme === 'cream'} onClick={() => onUpdateTheme('cream')}>
                          <Palette size={15} />{tr('settings.cream')}</button>
                      </div>
                    </fieldset>
                    <fieldset className="settings-section settings-section-view">
                      <legend>{tr('settings.defaultFileView')}</legend>
                      <div className="settings-view-options" role="group" aria-label={tr('settings.defaultFileView')}>
                        <button
                          type="button"
                          className="settings-view-option"
                          aria-pressed={settingsForm.defaultView === 'icons'}
                          onClick={() => onUpdateDefaultView('icons')}
                        >
                          <LayoutGrid size={15} />{tr('settings.iconView')}</button>
                        <button
                          type="button"
                          className="settings-view-option"
                          aria-pressed={settingsForm.defaultView === 'details'}
                          onClick={() => onUpdateDefaultView('details')}
                        >
                          <List size={16} />{tr('settings.details')}</button>
                      </div>
                    </fieldset>
                    <fieldset className="settings-section settings-section-startup">
                      <legend>{tr('settings.startupConnection')}</legend>
                      <label className="field settings-startup-profile">
                        <span>{tr('settings.connectOnStartup')}</span>
                        <select
                          value={settingsForm.startupProfileId}
                          onChange={(event) => onUpdateStartupProfile(event.target.value)}
                        >
                          <option value="">{tr('settings.doNotConnectAutomaticallyOpenHome')}</option>
                          {profiles.map((profile) => (
                            <option value={profile.id} key={profile.id}>
                              {profile.name}（{profile.username}@{profile.host}:{profile.port}）
                            </option>
                          ))}
                        </select>
                      </label>
                      {settingsForm.startupProfileId && (
                        <div className="settings-startup-kind">
                          <span className="settings-field-label">{tr('settings.connectionType')}</span>
                          <div className="settings-view-options" role="group" aria-label={tr('settings.startupConnectionType')}>
                            <button
                              type="button"
                              className="settings-view-option"
                              aria-pressed={settingsForm.startupKind === 'files'}
                              onClick={() => onUpdateStartupKind('files')}
                            >
                              <FolderOpen size={15} />{tr('common.fileManager')}</button>
                            <button
                              type="button"
                              className="settings-view-option"
                              aria-pressed={settingsForm.startupKind === 'terminal'}
                              onClick={() => onUpdateStartupKind('terminal')}
                            >
                              <Terminal size={15} />{tr('settings.sshTerminal')}</button>
                          </div>
                        </div>
                      )}
                    </fieldset>
                    <fieldset className="settings-section settings-section-preview">
                      <legend>{tr('settings.previewSizeLimits')}</legend>
                      <div className="settings-preview-grid">
                        {previewLimitFields.map(({ key, label }) => (
                          <label className="field" key={key}>
                            <span>{renderMessage(label)}</span>
                            <input required type="number" min="1" step="1" value={settingsForm[key]} onChange={(event) => onUpdateSettings(key, event.target.value)} />
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="settings-section settings-section-performance">
                      <legend>{tr('settings.performanceMonitoring')}</legend>
                      <label className="field settings-performance-interval">
                        <span>{tr('settings.samplingIntervalSeconds')}</span>
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
                      {invalidPerformanceSampleInterval && <p className="settings-performance-error" role="alert">{tr('settings.samplingIntervalMustBeAnIntegerFrom1To300')}</p>}
                      <div className="settings-performance-grid">
                        {performanceThresholdFields.map(({ label, warning, critical, unit, step }) => (
                          <div className="settings-performance-row" key={warning}>
                            <span>{renderMessage(label)}</span>
                            <label>
                              <span>{tr('settings.warning')}{unit ? `（${unit}）` : ''}</span>
                              <input required type="number" min="0" max="100" step={step} value={settingsForm.performanceThresholds[warning]} onChange={(event) => onUpdateSettings(warning, event.target.value)} />
                            </label>
                            <label>
                              <span>{tr('settings.critical')}{unit ? `（${unit}）` : ''}</span>
                              <input required type="number" min="0" max="100" step={step} value={settingsForm.performanceThresholds[critical]} onChange={(event) => onUpdateSettings(critical, event.target.value)} />
                            </label>
                          </div>
                        ))}
                      </div>
                      {invalidPerformanceThresholds && <p className="settings-performance-error" role="alert">{tr('settings.thresholdsMustBeBetween0And100WithWarningBelow')}</p>}
                    </fieldset>
                    <details className="settings-section settings-section-file-types" aria-labelledby="file-type-categories-title">
                      <summary className="settings-disclosure-summary">
                        <h3 id="file-type-categories-title">{tr('settings.fileTypeCategories')}</h3>
                        <ChevronRight className="settings-disclosure-chevron" size={15} />
                      </summary>
                      <div className="file-type-categories-content">
                        <div className="file-type-categories-heading">
                        <button type="button" className="text-button" onClick={onResetFileTypeExtensions}>{tr('settings.restoreDefaults')}</button>
                        </div>
                        {fileTypeRegistry.map((definition) => (
                          <FileTypeCategoryEditor
                            key={definition.id}
                            category={definition.id}
                            label={renderMessage(fileTypeMessages[definition.id].label)}
                            capabilityDescription={renderMessage(fileTypeMessages[definition.id].description)}
                            extensions={settingsForm.fileTypeExtensions[definition.id]}
                            onAdd={onAddFileTypeExtension}
                            onRemove={onRemoveFileTypeExtension}
                          />
                        ))}
                      </div>
                    </details>
                    <fieldset className="settings-section settings-section-transfer">
                      <legend>{tr('settings.fileTransfers')}</legend>
                      <label className="field settings-transfer-concurrency">
                        <span>{tr('settings.concurrentFileTransfers')}</span>
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
                        <h3 id="command-aliases-title">{tr('settings.commandAliases')}</h3>
                        <ChevronRight className="settings-disclosure-chevron" size={15} />
                      </summary>
                      <div className="command-alias-control-row">
                        <label className="field command-alias-profile-field">
                          <span>{tr('settings.server')}</span>
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
                          <span>{tr('settings.aliasCount', { count: aliasSnapshot?.aliases.length ?? 0 })}</span>
                          <span className={'command-alias-status ' + (aliasSnapshot?.status ?? 'unsynced')}>
                            {aliasSnapshot?.status === 'synced'
                              ? tr('settings.synced', { "value1": aliasSnapshot.syncedAt ? new Date(aliasSnapshot.syncedAt).toLocaleString(formatLocale()) : '' })
                              : aliasSnapshot?.status === 'stale'
                                ? tr('settings.resyncNeeded', { "value1": aliasSnapshot.syncedAt ? ` · ${new Date(aliasSnapshot.syncedAt).toLocaleString(formatLocale())}` : '' })
                                : tr('settings.notSynced')}
                          </span>
                        </div>
                        <button type="button" className="secondary-button command-alias-sync" disabled={aliasOperationBusy || !aliasProfileId} onClick={onSyncAliases}>
                          {aliasOperationBusy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}
                          {aliasOperationBusy ? tr('common.processing') : aliasSnapshot?.status === 'synced' ? tr('settings.resync') : tr('settings.sync')}
                        </button>
                      </div>
                      <div className="command-alias-list">
                        {!aliasProfileId ? (
                          <div className="command-alias-empty">{tr('settings.addAServerConnectionFirst')}</div>
                        ) : aliasSnapshot?.aliases.length ? aliasSnapshot.aliases.map((alias) => (
                          <div className="command-alias-row" key={alias.name}>
                            <div className="command-alias-copy">
                              <code>{alias.name}</code>
                              <span>{alias.command}</span>
                              {!alias.removable && <small>{renderMessage(alias.removalReason)}</small>}
                            </div>
                            <button
                              type="button"
                              className="icon-button command-alias-delete"
                              title={renderMessage(alias.removable ? tr('settings.delete', { "name": alias.name }) : alias.removalReason ?? tr('settings.thisAliasCannotBeSafelyDeleted'))}
                              aria-label={alias.removable ? tr('settings.delete', { "name": alias.name }) : tr('common.disabledAction', { action: alias.name, reason: alias.removalReason ?? msg('settings.cannotSafelyDelete') })}
                              disabled={aliasOperationBusy || !alias.removable}
                              onClick={() => onRequestAliasDelete(alias)}
                            ><Trash2 size={14} /></button>
                          </div>
                        )) : (
                          <div className="command-alias-empty">{aliasSnapshot?.status === 'synced' ? tr('settings.theServerHasNoCommandAliases') : tr('settings.serverAliasesHaveNotBeenSynced')}</div>
                        )}
                      </div>
                      <div className="command-alias-add-row">
                        <label className="field">
                          <span>{tr('settings.aliasName')}</span>
                          <input autoCapitalize="none" autoComplete="off" disabled={aliasOperationBusy || !aliasProfileId} value={aliasName} onChange={(event) => onUpdateAliasName(event.target.value)} placeholder={tr('settings.eGLl')} />
                        </label>
                        <label className="field">
                          <span>{tr('connections.actualCommand')}</span>
                          <input autoCapitalize="none" autoComplete="off" disabled={aliasOperationBusy || !aliasProfileId} value={aliasCommand} onChange={(event) => onUpdateAliasCommand(event.target.value)} placeholder={tr('settings.eGLsAlf')} />
                        </label>
                        <button type="button" className="primary-button command-alias-add" disabled={aliasOperationBusy || !aliasProfileId || aliasSnapshot?.status !== 'synced'} onClick={onAddAlias} title={tr('settings.addCommandAlias')} aria-label={tr('settings.addCommandAlias')}><Plus size={15} />{tr('settings.add')}</button>
                      </div>
                      <p className="command-alias-note">{tr('settings.bashOnlyAddingOrDeletingAliasesModifiesBashrcOnThe')}</p>
                    </details>
                  </div>
                </section>
              </div>
            )}
    </>
  )
}
