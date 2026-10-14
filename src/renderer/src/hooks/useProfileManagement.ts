import { useEffect, useState, type FormEvent } from 'react'
import type { PreviewLimits, SaveProfileInput, ServerProfile } from '@shared/types'
import type { FileViewMode, PreviewLimitKey, ProfileForm, SettingsForm } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { emptyForm, errorMessage, previewLimitFields, readDefaultView, toPreviewLimitsForm } from '@/app-utils'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: string) => void
  clearToast: () => void
  onProfileSaved: (profile: ServerProfile) => void
  onProfileDeleted: (profileId: string) => void
  onDefaultViewChange: (mode: FileViewMode) => void
}

export function useProfileManagement({ showToast, clearToast, onProfileSaved, onProfileDeleted, onDefaultViewChange }: UseProfileManagementOptions) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
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
    void refreshProfiles().catch((error) => showToast('error', errorMessage(error)))
  }, [showToast])

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
      setSettingsForm({ ...toPreviewLimitsForm(await window.remoteFiles.getPreviewLimits()), defaultView: readDefaultView() })
    } catch (error) {
      showToast('error', '读取设置失败：' + errorMessage(error))
    } finally {
      setSettingsLoading(false)
    }
  }

  const updateSettingsForm = (key: PreviewLimitKey, value: string) => {
    setSettingsForm((current) => current ? { ...current, [key]: value } : current)
  }

  const updateDefaultView = (defaultView: FileViewMode) => {
    setSettingsForm((current) => current ? { ...current, defaultView } : current)
  }

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsForm) return
    const limits: PreviewLimits = {
      textMiB: Number(settingsForm.textMiB),
      imageMiB: Number(settingsForm.imageMiB),
      audioMiB: Number(settingsForm.audioMiB),
      videoMiB: Number(settingsForm.videoMiB),
    }
    if (previewLimitFields.some(({ key }) => !Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > 1024)) {
      showToast('error', '预览上限必须是 1 到 1024 之间的整数')
      return
    }

    setSettingsSaving(true)
    try {
      await window.remoteFiles.savePreviewLimits(limits)
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
    updateDefaultView,
    submitSettings,
    closeProfileDialog,
    closeSettingsDialog,
  }
}
