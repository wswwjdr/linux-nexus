import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AppSettings, AppSettingsPatch, PreviewExtensions, PreviewType, SaveProfileInput, ServerProfile, SessionKind, StartupConnection, ThemeMode } from '@shared/types'
import type { FileViewMode, ProfileForm, SettingsFieldKey, SettingsForm } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { emptyForm, errorMessage, toPreviewLimitsForm } from '@/app-utils'
import { DEFAULT_PREVIEW_EXTENSIONS } from '@shared/preview-file-type'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: string) => void
  onProfileSaved: (profile: ServerProfile) => void
  onProfileDeleted: (profileId: string) => void
  onDefaultViewChange: (mode: FileViewMode) => void
  onPreviewExtensionsChange: (extensions: PreviewExtensions) => void
}

export function useProfileManagement({ showToast, onProfileSaved, onProfileDeleted, onDefaultViewChange, onPreviewExtensionsChange }: UseProfileManagementOptions) {
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
    if (key in current && key !== 'previewExtensions' && key !== 'startupConnection') {
      return { ...current, [key]: String(settings[key as keyof AppSettings]) }
    }
    if (key === 'previewExtensions') return { ...current, previewExtensions: settings.previewExtensions }
    if (key === 'startupConnection') return {
      ...current,
      startupProfileId: settings.startupConnection?.profileId ?? '',
      startupKind: settings.startupConnection?.kind ?? 'sftp',
    }
    return current
  }

  const reflectSetting = (key: keyof AppSettings, settings: AppSettings) => {
    if (key === 'defaultView') onDefaultViewChange(settings.defaultView)
    if (key === 'previewExtensions') onPreviewExtensionsChange(settings.previewExtensions)
    if (key === 'startupConnection') setStartupConnection(settings.startupConnection)
  }

  const persistSetting = (key: keyof AppSettings, patch: AppSettingsPatch) => {
    const version = (settingsVersionsRef.current.get(key) ?? 0) + 1
    settingsVersionsRef.current.set(key, version)
    settingsWritesRef.current = settingsWritesRef.current.then(async () => {
      try {
        const saved = await window.remoteFiles.updateAppSettings(patch)
        persistedSettingsRef.current = saved
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
        onPreviewExtensionsChange(settings.previewExtensions)
      })
      .catch((error) => showToast('error', '读取设置失败：' + errorMessage(error)))
      .finally(() => setStartupSettingsLoaded(true))
  }, [showToast, onPreviewExtensionsChange])

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
        previewExtensions: Object.fromEntries(Object.entries(settings.previewExtensions).map(([type, extensions]) => [type, [...extensions]])) as PreviewExtensions,
        transferFileConcurrency: String(settings.transferFileConcurrency),
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
    updateSettingsDraft((current) => ({ ...current, [key]: value }))
    const numericValue = Number(value)
    const maximum = key === 'transferFileConcurrency' ? 16 : 1024
    if (Number.isInteger(numericValue) && numericValue >= 1 && numericValue <= maximum) {
      persistSetting(key, { [key]: numericValue })
    } else {
      settingsVersionsRef.current.set(key, (settingsVersionsRef.current.get(key) ?? 0) + 1)
    }
  }

  const addPreviewExtension = (type: PreviewType, extension: string) => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      previewExtensions: {
        ...current.previewExtensions,
        [type]: [...new Set([...current.previewExtensions[type], extension])],
      },
    }))
    if (next) {
      onPreviewExtensionsChange(next.previewExtensions)
      persistSetting('previewExtensions', { previewExtensions: next.previewExtensions })
    }
  }

  const removePreviewExtension = (type: PreviewType, extension: string) => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      previewExtensions: {
        ...current.previewExtensions,
        [type]: current.previewExtensions[type].filter((candidate) => candidate !== extension),
      },
    }))
    if (next) {
      onPreviewExtensionsChange(next.previewExtensions)
      persistSetting('previewExtensions', { previewExtensions: next.previewExtensions })
    }
  }

  const resetPreviewExtensions = () => {
    const next = updateSettingsDraft((current) => ({
      ...current,
      previewExtensions: Object.fromEntries(Object.entries(DEFAULT_PREVIEW_EXTENSIONS).map(([type, extensions]) => [type, [...extensions]])) as PreviewExtensions,
    }))
    if (next) {
      onPreviewExtensionsChange(next.previewExtensions)
      persistSetting('previewExtensions', { previewExtensions: next.previewExtensions })
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
    addPreviewExtension,
    removePreviewExtension,
    resetPreviewExtensions,
    updateDefaultView,
    updateTheme,
    updateStartupProfile,
    updateStartupKind,
    closeProfileDialog,
    closeSettingsDialog,
  }
}
