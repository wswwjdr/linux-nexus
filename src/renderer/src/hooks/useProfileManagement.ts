import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AppSettings, AppSettingsPatch, FileTypeCategory, PerformanceThresholds, FileTypeExtensions, SaveProfileInput, ServerProfile, SessionKind, StartupConnection, ThemeMode } from '@shared/types'
import { performanceThresholdsToForm, type FileViewMode, type PerformanceThresholdField, type ProfileForm, type SettingsFieldKey, type SettingsForm } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { emptyForm, errorMessage, toPreviewLimitsForm } from '@/app-utils'
import { defaultFileTypeExtensions } from '@shared/app-settings'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: string) => void
  onProfileSaved: (profile: ServerProfile) => void
  onProfileDeleted: (profileId: string) => void
  onDefaultViewChange: (mode: FileViewMode) => void
  onFileTypeExtensionsChange: (extensions: FileTypeExtensions) => void
  onPerformanceThresholdsChange: (thresholds: PerformanceThresholds) => void
}

const thresholdFieldParts: Record<PerformanceThresholdField, keyof PerformanceThresholds> = {
  cpuWarning: 'cpu',
  cpuCritical: 'cpu',
  memoryWarning: 'memory',
  memoryCritical: 'memory',
  diskWarning: 'disk',
  diskCritical: 'disk',
  loadPerCoreWarning: 'loadPerCore',
  loadPerCoreCritical: 'loadPerCore',
}

export function useProfileManagement({ showToast, onProfileSaved, onProfileDeleted, onDefaultViewChange, onFileTypeExtensionsChange, onPerformanceThresholdsChange }: UseProfileManagementOptions) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [startupSettingsLoaded, setStartupSettingsLoaded] = useState(false)
  const [startupConnection, setStartupConnection] = useState<StartupConnection | null>(null)
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; form: ProfileForm } | null>(null)
  const [profileDeleteDialog, setProfileDeleteDialog] = useState<ServerProfile | null>(null)
  const [profileDeleteError, setProfileDeleteError] = useState<string | null>(null)
  const [profileDeleting, setProfileDeleting] = useState(false)
  const [settingsForm, setSettingsForm] = useState<SettingsForm | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const settingsFormRef = useRef<SettingsForm | null>(null)
  const settingsWritesRef = useRef<Promise<void>>(Promise.resolve())
  const persistedSettingsRef = useRef<AppSettings | null>(null)
  const settingsVersionsRef = useRef(new Map<keyof AppSettings, number>())

  const replaceSettingsForm = (next: SettingsForm | null) => {
    settingsFormRef.current = next
    setSettingsForm(next)
  }

  const updateSettingsDraft = (update: (current: SettingsForm) => SettingsForm) => {
    const current = settingsFormRef.current
    if (!current) return null
    const next = update(current)
    replaceSettingsForm(next)
    return next
  }

  const formWithSetting = (current: SettingsForm, key: keyof AppSettings, settings: AppSettings): SettingsForm => {
    if (key in current && key !== 'fileTypeExtensions' && key !== 'startupConnection' && key !== 'performanceThresholds') {
      return { ...current, [key]: String(settings[key as keyof AppSettings]) }
    }
    if (key === 'fileTypeExtensions') return { ...current, fileTypeExtensions: settings.fileTypeExtensions }
    if (key === 'performanceThresholds') {
      return { ...current, performanceThresholds: performanceThresholdsToForm(settings.performanceThresholds) }
    }
    if (key === 'startupConnection') return {
      ...current,
      startupProfileId: settings.startupConnection?.profileId ?? '',
      startupKind: settings.startupConnection?.kind ?? 'sftp',
    }
    return current
  }

  const reflectSetting = (key: keyof AppSettings, settings: AppSettings) => {
    if (key === 'defaultView') onDefaultViewChange(settings.defaultView)
    if (key === 'fileTypeExtensions') onFileTypeExtensionsChange(settings.fileTypeExtensions)
    if (key === 'startupConnection') setStartupConnection(settings.startupConnection)
    if (key === 'performanceThresholds') onPerformanceThresholdsChange(settings.performanceThresholds)
  }

  const persistSetting = (key: keyof AppSettings, patch: AppSettingsPatch) => {
    const version = (settingsVersionsRef.current.get(key) ?? 0) + 1
    settingsVersionsRef.current.set(key, version)
    settingsWritesRef.current = settingsWritesRef.current.then(async () => {
      try {
        const saved = await window.remoteFiles.updateAppSettings(patch)
        persistedSettingsRef.current = saved
        if (key === 'performanceThresholds') onPerformanceThresholdsChange(saved.performanceThresholds)
      } catch (error) {
        showToast('error', '保存设置失败：' + errorMessage(error))
        let saved = persistedSettingsRef.current
        try {
          saved = await window.remoteFiles.getAppSettings()
          persistedSettingsRef.current = saved
        } catch (readError) {
          showToast('error', '重新读取设置失败：' + errorMessage(readError))
        }
        if (saved && settingsVersionsRef.current.get(key) === version) {
          updateSettingsDraft((current) => formWithSetting(current, key, saved!))
          reflectSetting(key, saved)
        }
      }
    })
  }

  const refreshProfiles = async () => {
    setProfiles(await window.remoteFiles.listProfiles())
  }

  useEffect(() => {
    void refreshProfiles()
      .catch((error) => showToast('error', errorMessage(error)))
      .finally(() => setProfilesLoaded(true))
    void window.remoteFiles.getAppSettings()
      .then((settings) => {
        persistedSettingsRef.current = settings
        setStartupConnection(settings.startupConnection)
        onDefaultViewChange(settings.defaultView)
        onFileTypeExtensionsChange(settings.fileTypeExtensions)
        onPerformanceThresholdsChange(settings.performanceThresholds)
      })
      .catch((error) => showToast('error', '读取设置失败：' + errorMessage(error)))
      .finally(() => setStartupSettingsLoaded(true))
  }, [showToast, onFileTypeExtensionsChange, onPerformanceThresholdsChange])

  const openProfileDialog = (mode: 'create' | 'edit', profile?: ServerProfile) => {
    setDialog({
      mode,
      form: profile
        ? {
            id: profile.id,
            name: profile.name,
            host: profile.host,
            port: String(profile.port),
            username: profile.username,
            password: '',
          }
        : emptyForm(),
    })
  }

  const openSettingsDialog = async () => {
    if (settingsLoading) return
    setSettingsLoading(true)
    try {
      await settingsWritesRef.current
      const settings = await window.remoteFiles.getAppSettings()
      persistedSettingsRef.current = settings
      const profileId = settings.startupConnection?.profileId
      replaceSettingsForm({
        ...toPreviewLimitsForm(settings),
        theme: settings.theme,
        defaultView: settings.defaultView,
        fileTypeExtensions: Object.fromEntries(Object.entries(settings.fileTypeExtensions).map(([type, extensions]) => [type, [...extensions]])) as FileTypeExtensions,
        transferFileConcurrency: String(settings.transferFileConcurrency),
        performanceSampleIntervalSeconds: String(settings.performanceSampleIntervalSeconds),
        performanceThresholds: performanceThresholdsToForm(settings.performanceThresholds),
        startupProfileId: profileId && profiles.some((profile) => profile.id === profileId) ? profileId : '',
        startupKind: settings.startupConnection?.kind ?? 'sftp',
      })
      setStartupConnection(settings.startupConnection)
    } catch (error) {
      showToast('error', '读取设置失败：' + errorMessage(error))
    } finally {
      setSettingsLoading(false)
    }
  }

  const updateSettingsForm = (key: SettingsFieldKey, value: string) => {
    const next = updateSettingsDraft((current) => {
      if (key in thresholdFieldParts) {
        return { ...current, performanceThresholds: { ...current.performanceThresholds, [key]: value } }
      }
      return { ...current, [key]: value }
    })
    if (key in thresholdFieldParts) {
      if (!next) return
      const thresholds = {
        cpu: { warning: Number(next.performanceThresholds.cpuWarning), critical: Number(next.performanceThresholds.cpuCritical) },
        memory: { warning: Number(next.performanceThresholds.memoryWarning), critical: Number(next.performanceThresholds.memoryCritical) },
        disk: { warning: Number(next.performanceThresholds.diskWarning), critical: Number(next.performanceThresholds.diskCritical) },
        loadPerCore: { warning: Number(next.performanceThresholds.loadPerCoreWarning), critical: Number(next.performanceThresholds.loadPerCoreCritical) },
      }
      const inputsValid = Object.values(next.performanceThresholds).every((text) => text.trim() !== ''
        && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 100)
      const pairsValid = Object.values(thresholds).every((pair) => pair.warning < pair.critical)
      if (inputsValid && pairsValid) persistSetting('performanceThresholds', { performanceThresholds: thresholds })
      else settingsVersionsRef.current.set('performanceThresholds', (settingsVersionsRef.current.get('performanceThresholds') ?? 0) + 1)
      return
    }
    const numericValue = Number(value)
    const maximum = key === 'transferFileConcurrency' ? 16
      : key === 'performanceSampleIntervalSeconds' ? 300
        : 1024
    const settingsKey = key as keyof AppSettings
    if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= maximum) {
      persistSetting(settingsKey, { [settingsKey]: numericValue })
    } else {
      settingsVersionsRef.current.set(settingsKey, (settingsVersionsRef.current.get(settingsKey) ?? 0) + 1)
    }
  }

  const addFileTypeExtension = (category: FileTypeCategory, extension: string) => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      fileTypeExtensions: {
        ...current.fileTypeExtensions,
        [category]: [...new Set([...current.fileTypeExtensions[category], extension])],
      },
    }))
    if (next) {
      onFileTypeExtensionsChange(next.fileTypeExtensions)
      persistSetting('fileTypeExtensions', { fileTypeExtensions: next.fileTypeExtensions })
    }
  }

  const removeFileTypeExtension = (category: FileTypeCategory, extension: string) => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      fileTypeExtensions: {
        ...current.fileTypeExtensions,
        [category]: current.fileTypeExtensions[category].filter((candidate) => candidate !== extension),
      },
    }))
    if (next) {
      onFileTypeExtensionsChange(next.fileTypeExtensions)
      persistSetting('fileTypeExtensions', { fileTypeExtensions: next.fileTypeExtensions })
    }
  }

  const resetFileTypeExtensions = () => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      fileTypeExtensions: defaultFileTypeExtensions(),
    }))
    if (next) {
      onFileTypeExtensionsChange(next.fileTypeExtensions)
      persistSetting('fileTypeExtensions', { fileTypeExtensions: next.fileTypeExtensions })
    }
  }

  const updateDefaultView = (defaultView: FileViewMode) => {
    updateSettingsDraft((current) => ({ ...current, defaultView }))
    onDefaultViewChange(defaultView)
    persistSetting('defaultView', { defaultView })
  }

  const updateTheme = (theme: ThemeMode) => {
    updateSettingsDraft((current) => ({ ...current, theme }))
    persistSetting('theme', { theme })
  }

  const updateStartupProfile = (startupProfileId: string) => {
    const current = settingsFormRef.current
    if (!current) return
    const startupConnection = startupProfileId ? { profileId: startupProfileId, kind: current.startupKind } : null
    updateSettingsDraft((form) => ({ ...form, startupProfileId }))
    setStartupConnection(startupConnection)
    persistSetting('startupConnection', { startupConnection })
  }

  const updateStartupKind = (startupKind: SessionKind) => {
    const current = settingsFormRef.current
    if (!current) return
    const startupConnection = current.startupProfileId ? { profileId: current.startupProfileId, kind: startupKind } : null
    updateSettingsDraft((form) => ({ ...form, startupKind }))
    setStartupConnection(startupConnection)
    persistSetting('startupConnection', { startupConnection })
  }

  const updateProfileForm = (patch: Partial<ProfileForm>) => {
    setDialog((current) =>
      current ? { ...current, form: { ...current.form, ...patch } } : current,
    )
  }

  const submitProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dialog) return
    const input: SaveProfileInput = {
      profile: {
        id: dialog.form.id,
        name: dialog.form.name,
        host: dialog.form.host,
        port: Number(dialog.form.port),
        username: dialog.form.username,
      },
      password: dialog.form.password || undefined,
    }
    try {
      const savedProfile = await window.remoteFiles.saveProfile(input)
      onProfileSaved(savedProfile)
      await refreshProfiles()
      setDialog(null)
    } catch (error) {
      showToast('error', errorMessage(error))
    }
  }

  const requestProfileDeletion = (profile: ServerProfile) => {
    setProfileDeleteError(null)
    setProfileDeleteDialog(profile)
  }

  const closeProfileDeleteDialog = () => {
    if (profileDeleting) return
    setProfileDeleteDialog(null)
    setProfileDeleteError(null)
  }

  const confirmProfileDeletion = async () => {
    if (!profileDeleteDialog || profileDeleting) return
    const profile = profileDeleteDialog
    setProfileDeleting(true)
    setProfileDeleteError(null)
    try {
      await window.remoteFiles.deleteProfile(profile.id)
      setProfiles((current) => current.filter((item) => item.id !== profile.id))
      setStartupConnection((current) => current?.profileId === profile.id ? null : current)
      onProfileDeleted(profile.id)
      setProfileDeleteDialog(null)
    } catch (error) {
      setProfileDeleteError(errorMessage(error))
    } finally {
      setProfileDeleting(false)
    }
  }

  const closeProfileDialog = () => setDialog(null)
  const closeSettingsDialog = () => replaceSettingsForm(null)

  return {
    profiles,
    profileDataLoaded: profilesLoaded && startupSettingsLoaded,
    startupConnection,
    profileDialog: dialog,
    profileDeleteDialog,
    profileDeleteError,
    profileDeleting,
    settingsForm,
    settingsLoading,
    openProfileDialog,
    openSettingsDialog,
    updateProfileForm,
    submitProfile,
    requestProfileDeletion,
    closeProfileDeleteDialog,
    confirmProfileDeletion,
    updateSettingsForm,
    addFileTypeExtension,
    removeFileTypeExtension,
    resetFileTypeExtensions,
    updateDefaultView,
    updateTheme,
    updateStartupProfile,
    updateStartupKind,
    closeProfileDialog,
    closeSettingsDialog,
  }
}
