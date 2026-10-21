import { useEffect, useState, type FormEvent } from 'react'
import type { AppSettings, PreviewExtensions, PreviewLimits, PreviewType, SaveProfileInput, ServerProfile, SessionKind, StartupConnection } from '@shared/types'
import type { FileViewMode, ProfileForm, SettingsFieldKey, SettingsForm } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { emptyForm, errorMessage, previewLimitFields, readDefaultView, toPreviewLimitsForm } from '@/app-utils'
import { DEFAULT_PREVIEW_EXTENSIONS } from '@shared/preview-file-type'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: string) => void
  clearToast: () => void
  onProfileSaved: (profile: ServerProfile) => void
  onProfileDeleted: (profileId: string) => void
  onDefaultViewChange: (mode: FileViewMode) => void
  onPreviewExtensionsChange: (extensions: PreviewExtensions) => void
}

export function useProfileManagement({ showToast, clearToast, onProfileSaved, onProfileDeleted, onDefaultViewChange, onPreviewExtensionsChange }: UseProfileManagementOptions) {
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
  const [settingsSaving, setSettingsSaving] = useState(false)

  const refreshProfiles = async () => {
    setProfiles(await window.remoteFiles.listProfiles())
  }

  useEffect(() => {
    void refreshProfiles()
      .catch((error) => showToast('error', errorMessage(error)))
      .finally(() => setProfilesLoaded(true))
    void window.remoteFiles.getAppSettings()
      .then((settings) => {
        setStartupConnection(settings.startupConnection)
        onPreviewExtensionsChange(settings.previewExtensions)
      })
      .catch((error) => showToast('error', '读取设置失败：' + errorMessage(error)))
      .finally(() => setStartupSettingsLoaded(true))
  }, [showToast, onPreviewExtensionsChange])

  const openProfileDialog = (mode: 'create' | 'edit', profile?: ServerProfile) => {
    clearToast()
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
    if (settingsLoading || settingsSaving) return
    setSettingsLoading(true)
    try {
      const settings = await window.remoteFiles.getAppSettings()
      const profileId = settings.startupConnection?.profileId
      setSettingsForm({
        ...toPreviewLimitsForm(settings),
        previewExtensions: Object.fromEntries(Object.entries(settings.previewExtensions).map(([type, extensions]) => [type, [...extensions]])) as PreviewExtensions,
        transferFileConcurrency: String(settings.transferFileConcurrency),
        defaultView: readDefaultView(),
        startupProfileId: profileId && profiles.some((profile) => profile.id === profileId) ? profileId : '',
        startupKind: settings.startupConnection?.kind ?? 'sftp',
      })
    } catch (error) {
      showToast('error', '读取设置失败：' + errorMessage(error))
    } finally {
      setSettingsLoading(false)
    }
  }

  const updateSettingsForm = (key: SettingsFieldKey, value: string) => {
    setSettingsForm((current) => current ? { ...current, [key]: value } : current)
  }

  const addPreviewExtension = (type: PreviewType, extension: string) => {
    setSettingsForm((current) => current
      ? {
          ...current,
          previewExtensions: {
            ...current.previewExtensions,
            [type]: [...new Set([...current.previewExtensions[type], extension])],
          },
        }
      : current)
  }

  const removePreviewExtension = (type: PreviewType, extension: string) => {
    setSettingsForm((current) => current
      ? {
          ...current,
          previewExtensions: {
            ...current.previewExtensions,
            [type]: current.previewExtensions[type].filter((candidate) => candidate !== extension),
          },
        }
      : current)
  }

  const resetPreviewExtensions = () => {
    setSettingsForm((current) => current
      ? {
          ...current,
          previewExtensions: Object.fromEntries(Object.entries(DEFAULT_PREVIEW_EXTENSIONS).map(([type, extensions]) => [type, [...extensions]])) as PreviewExtensions,
        }
      : current)
  }

  const updateDefaultView = (defaultView: FileViewMode) => {
    setSettingsForm((current) => current ? { ...current, defaultView } : current)
  }

  const updateStartupProfile = (startupProfileId: string) => {
    setSettingsForm((current) => current ? { ...current, startupProfileId } : current)
  }

  const updateStartupKind = (startupKind: SessionKind) => {
    setSettingsForm((current) => current ? { ...current, startupKind } : current)
  }

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsForm) return
    const limits: PreviewLimits = {
      textMiB: Number(settingsForm.textMiB),
      pdfMiB: Number(settingsForm.pdfMiB),
      imageMiB: Number(settingsForm.imageMiB),
      audioMiB: Number(settingsForm.audioMiB),
      videoMiB: Number(settingsForm.videoMiB),
    }
    if (previewLimitFields.some(({ key }) => !Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > 1024)) {
      showToast('error', '预览上限必须是 1 到 1024 之间的整数')
      return
    }
    const transferFileConcurrency = Number(settingsForm.transferFileConcurrency)
    if (!Number.isInteger(transferFileConcurrency) || transferFileConcurrency < 1 || transferFileConcurrency > 16) {
      showToast('error', '同时传输文件数必须是 1 到 16 之间的整数')
      return
    }

    setSettingsSaving(true)
    try {
      const settings: AppSettings = {
        ...limits,
        previewExtensions: settingsForm.previewExtensions,
        transferFileConcurrency,
        startupConnection: settingsForm.startupProfileId
          ? { profileId: settingsForm.startupProfileId, kind: settingsForm.startupKind }
          : null,
      }
      const savedSettings = await window.remoteFiles.saveAppSettings(settings)
      setStartupConnection(settings.startupConnection)
      onPreviewExtensionsChange(savedSettings.previewExtensions)
      window.localStorage.setItem('remote-files:default-view', settingsForm.defaultView)
      onDefaultViewChange(settingsForm.defaultView)
      setSettingsForm(null)
      clearToast()
    } catch (error) {
      showToast('error', '保存设置失败：' + errorMessage(error))
    } finally {
      setSettingsSaving(false)
    }
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
      clearToast()
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
      clearToast()
    } catch (error) {
      setProfileDeleteError(errorMessage(error))
    } finally {
      setProfileDeleting(false)
    }
  }

  const closeProfileDialog = () => setDialog(null)
  const closeSettingsDialog = () => setSettingsForm(null)

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
    settingsSaving,
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
    updateStartupProfile,
    updateStartupKind,
    submitSettings,
    closeProfileDialog,
    closeSettingsDialog,
  }
}
