import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { tr } from '@shared/i18n/messages'
import type { AppSettings, AppSettingsUpdate, FileTypeCategory, SettingsDomain, ThemeMode } from '@shared/types'
import type { LanguagePreference } from '@shared/i18n/languages'
import { defaultFileTypeExtensions, settingsDomains } from '@shared/app-settings'
import { applyApplicationLanguage } from '@/application-settings'
import { applyRendererTheme } from '@/app-theme'
import { performanceThresholdsToForm, type FileViewMode, type SettingsFieldKey, type SettingsForm } from '@/app-types'
import { toPreviewLimitsForm } from '@/app-utils'
import { SettingsAutosave } from '@/settings-autosave'

interface SettingsOptions {
  initialSettings: AppSettings
  onDefaultViewChange: (value: FileViewMode) => void
}

/** Converts persisted domains to editable inputs. @param settings Saved snapshot. @returns Independent form state. */
export function settingsToForm(settings: AppSettings): SettingsForm {
  return {
    ...toPreviewLimitsForm(settings.files.previewLimits),
    language: settings.general.language,
    theme: settings.general.theme,
    defaultView: settings.files.defaultView,
    fileTypeExtensions: structuredClone(settings.files.fileTypeExtensions),
    directoryUsageEntryLimit: String(settings.files.directoryUsageEntryLimit),
    transferFileConcurrency: String(settings.transfers.fileConcurrency),
    performanceSampleIntervalSeconds: String(settings.monitoring.sampleIntervalSeconds),
    performanceThresholds: performanceThresholdsToForm(settings.monitoring.thresholds),
    startupProfileId: settings.general.startupConnection?.profileId ?? '',
    startupKind: settings.general.startupConnection?.kind ?? 'files',
  }
}

/** Builds one complete settings domain. @param domain Target domain. @param form Editable values. @returns Unvalidated domain input. */
function domainValue(domain: SettingsDomain, form: SettingsForm): unknown {
  switch (domain) {
    case 'general':
      return {
        language: form.language,
        theme: form.theme,
        startupConnection: form.startupProfileId ? { profileId: form.startupProfileId, kind: form.startupKind } : null,
      }
    case 'files':
      return {
        defaultView: form.defaultView,
        fileTypeExtensions: form.fileTypeExtensions,
        directoryUsageEntryLimit: Number(form.directoryUsageEntryLimit),
        previewLimits: {
          textMiB: Number(form.textMiB),
          pdfMiB: Number(form.pdfMiB),
          imageMiB: Number(form.imageMiB),
          audioMiB: Number(form.audioMiB),
          videoMiB: Number(form.videoMiB),
        },
      }
    case 'transfers':
      return { fileConcurrency: Number(form.transferFileConcurrency) }
    case 'monitoring':
      return {
        sampleIntervalSeconds: Number(form.performanceSampleIntervalSeconds),
        thresholds: {
          cpu: {
            warning: Number(form.performanceThresholds.cpuWarning.trim() || NaN),
            critical: Number(form.performanceThresholds.cpuCritical.trim() || NaN),
          },
          memory: {
            warning: Number(form.performanceThresholds.memoryWarning.trim() || NaN),
            critical: Number(form.performanceThresholds.memoryCritical.trim() || NaN),
          },
          disk: {
            warning: Number(form.performanceThresholds.diskWarning.trim() || NaN),
            critical: Number(form.performanceThresholds.diskCritical.trim() || NaN),
          },
          loadPerCore: {
            warning: Number(form.performanceThresholds.loadPerCoreWarning.trim() || NaN),
            critical: Number(form.performanceThresholds.loadPerCoreCritical.trim() || NaN),
          },
        },
      }
  }
}

/** Owns persisted preferences, editing drafts and automatic saves. @param options Initial snapshot and runtime consumers. @returns Settings state and editing actions. */
export function useApplicationSettings(options: SettingsOptions) {
  const [settings, setSettings] = useState(options.initialSettings)
  const saved = useRef(settings)
  const reflected = useRef<AppSettings | null>(null)
  const [settingsForm, setForm] = useState<SettingsForm | null>(null)
  const draft = useRef<SettingsForm | null>(null)
  const [exitRequest, setExitRequest] = useState<string>()
  const [autosave] = useState(() => new SettingsAutosave())
  const reflect = useEffectEvent((value: AppSettings) => {
    const previous = reflected.current
    if (previous?.general.language !== value.general.language) applyApplicationLanguage(value)
    if (previous?.general.theme !== value.general.theme) applyRendererTheme(value.general.theme)
    if (previous?.files.defaultView !== value.files.defaultView) options.onDefaultViewChange(value.files.defaultView)
    reflected.current = value
  })
  useEffect(() => {
    saved.current = settings
    reflect(settings)
  }, [settings])
  useEffect(
    () =>
      window.remoteFiles.onAppSettingsChanged((value) => {
        if (
          draft.current &&
          saved.current.general.startupConnection?.profileId !== value.general.startupConnection?.profileId
        ) {
          replace({
            ...draft.current,
            startupProfileId: value.general.startupConnection?.profileId ?? '',
            startupKind: value.general.startupConnection?.kind ?? 'files',
          })
        }
        saved.current = value
        setSettings(value)
      }),
    [],
  )

  useEffect(
    () =>
      window.remoteFiles.onSettingsCloseRequested((id) => {
        void autosave.flush().then(async (success) => {
          if (success) await window.remoteFiles.completeSettingsClose(id, true)
          else {
            if (!draft.current) replace(settingsToForm(saved.current))
            setExitRequest(id)
          }
        })
      }),
    [autosave],
  )

  /** Completes a pending application-close request. @param allow Whether edits have been resolved. @returns Completion of the IPC response. */
  async function completeExit(allow: boolean): Promise<void> {
    if (!exitRequest) return
    await window.remoteFiles.completeSettingsClose(exitRequest, allow)
    setExitRequest(undefined)
  }

  /** Replaces the current editable snapshot. @param value New draft or closed state. */
  function replace(value: SettingsForm | null): void {
    draft.current = value
    setForm(value)
  }

  /** Edits and schedules a validated domain. @param domain Domain to commit. @param patch Edited inputs. @param delay Debounce duration. */
  function edit(domain: SettingsDomain, patch: Partial<SettingsForm>, delay = 500): void {
    if (!draft.current) return
    const previous = draft.current
    const next = { ...previous, ...patch }
    replace(next)
    const formField = Object.keys(patch)[0] as keyof SettingsForm
    const fieldNames: Partial<Record<keyof SettingsForm, string>> = {
      startupProfileId: 'startupConnection',
      startupKind: 'startupConnection',
      transferFileConcurrency: 'fileConcurrency',
      performanceSampleIntervalSeconds: 'sampleIntervalSeconds',
      performanceThresholds: 'thresholds',
    }
    const preview = formField.endsWith('MiB')
    const field = preview ? 'previewLimits' : (fieldNames[formField] ?? formField)
    const threshold =
      formField === 'performanceThresholds'
        ? Object.keys(next.performanceThresholds)
            .find(
              (key) =>
                next.performanceThresholds[key as keyof typeof next.performanceThresholds] !==
                previous.performanceThresholds[key as keyof typeof next.performanceThresholds],
            )
            ?.replace(/(Warning|Critical)$/, '')
        : undefined
    if (field === 'thresholds' && !threshold) return
    const subfield = preview ? formField : threshold
    const edited = domainValue(domain, next) as Record<string, unknown>
    /** Merges this edit with the latest saved domain at execution time. @returns A complete domain value. */
    const value = (): unknown => {
      const current = saved.current[domain] as unknown as Record<string, unknown>
      if (subfield)
        return {
          ...current,
          [field]: { ...(current[field] as object), [subfield]: (edited[field] as Record<string, unknown>)[subfield] },
        }
      return { ...current, [field]: edited[field] }
    }
    const parsed = settingsDomains[domain].safeParse(value())
    const invalidMessage = tr(
      {
        general: 'preferences.invalid',
        files: 'preferences.invalidFiles',
        transfers: 'preferences.invalidTransfers',
        monitoring: 'preferences.invalidMonitoring',
      }[domain] as 'preferences.invalid',
    )
    autosave.schedule(
      [domain, field, subfield].filter(Boolean).join('.'),
      async () => {
        if (!parsed.success) throw new Error(invalidMessage)
        const result = await window.remoteFiles.updateAppSettings({
          domain,
          value: settingsDomains[domain].parse(value()),
        } as AppSettingsUpdate)
        saved.current = result
        setSettings(result)
      },
      () => replace(settingsToForm(saved.current)),
      parsed.success ? undefined : invalidMessage,
      delay,
    )
  }

  /** Opens settings using the latest saved snapshot. */
  function openSettingsDialog(): void {
    replace(settingsToForm(saved.current))
  }
  /** Closes settings after the dialog has resolved pending edits. */
  function closeSettingsDialog(): void {
    replace(null)
  }
  /** Edits a numeric input or alert threshold. @param key Input identifier. @param value Raw input text. */
  function updateSettingsForm(key: SettingsFieldKey, value: string): void {
    if (!draft.current) return
    if (key in draft.current.performanceThresholds) {
      edit('monitoring', { performanceThresholds: { ...draft.current.performanceThresholds, [key]: value } })
    } else {
      const domain =
        key === 'transferFileConcurrency'
          ? 'transfers'
          : key === 'performanceSampleIntervalSeconds'
            ? 'monitoring'
            : 'files'
      edit(domain, { [key]: value })
    }
  }
  /** Adds a file extension. @param category File category. @param extension Normalized extension. */
  function addFileTypeExtension(category: FileTypeCategory, extension: string): void {
    if (draft.current)
      edit(
        'files',
        {
          fileTypeExtensions: {
            ...draft.current.fileTypeExtensions,
            [category]: [...new Set([...draft.current.fileTypeExtensions[category], extension])],
          },
        },
        0,
      )
  }
  /** Removes a file extension. @param category File category. @param extension Extension to remove. */
  function removeFileTypeExtension(category: FileTypeCategory, extension: string): void {
    if (draft.current)
      edit(
        'files',
        {
          fileTypeExtensions: {
            ...draft.current.fileTypeExtensions,
            [category]: draft.current.fileTypeExtensions[category].filter((value) => value !== extension),
          },
        },
        0,
      )
  }
  /** Restores default file extensions. */
  function resetFileTypeExtensions(): void {
    edit('files', { fileTypeExtensions: defaultFileTypeExtensions() }, 0)
  }
  /** Sets the default file view. @param defaultView View mode. */
  function updateDefaultView(defaultView: FileViewMode): void {
    edit('files', { defaultView }, 0)
  }
  /** Sets display language. @param language Language preference. */
  function updateLanguage(language: LanguagePreference): void {
    edit('general', { language }, 0)
  }
  /** Sets appearance. @param theme Theme preference. */
  function updateTheme(theme: ThemeMode): void {
    edit('general', { theme }, 0)
  }
  /** Sets the startup server. @param startupProfileId Server ID or empty selection. */
  function updateStartupProfile(startupProfileId: string): void {
    edit('general', { startupProfileId }, 0)
  }
  /** Sets startup connection kind. @param startupKind Connection type. */
  function updateStartupKind(startupKind: SettingsForm['startupKind']): void {
    edit('general', { startupKind }, 0)
  }

  return {
    settings,
    exitRequest,
    completeExit,
    settingsForm,
    autosave,
    startupConnection: settings.general.startupConnection,
    openSettingsDialog,
    closeSettingsDialog,
    updateSettingsForm,
    addFileTypeExtension,
    removeFileTypeExtension,
    resetFileTypeExtensions,
    updateDefaultView,
    updateLanguage,
    updateTheme,
    updateStartupProfile,
    updateStartupKind,
  }
}
