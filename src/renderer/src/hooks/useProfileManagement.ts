import { useEffect, useState, type FormEvent } from 'react'
import type { PreviewLimits, SaveProfileInput, ServerProfile } from '@shared/types'
import type { PreviewLimitKey, PreviewLimitsForm, ProfileForm } from '../app-types'
import type { ToastNotice } from '../GlobalToast'
import { emptyForm, errorMessage, previewLimitFields, toPreviewLimitsForm } from '../app-utils'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: string) => void
  clearToast: () => void
  onProfileDeleted: (profileId: string) => void
}

export function useProfileManagement({ showToast, clearToast, onProfileDeleted }: UseProfileManagementOptions) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; form: ProfileForm } | null>(null)
  const [settingsForm, setSettingsForm] = useState<PreviewLimitsForm | null>(null)
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
      setSettingsForm(toPreviewLimitsForm(await window.remoteFiles.getPreviewLimits()))
    } catch (error) {
      showToast('error', '读取设置失败：' + errorMessage(error))
    } finally {
      setSettingsLoading(false)
    }
  }

  const updateSettingsForm = (key: PreviewLimitKey, value: string) => {
    setSettingsForm((current) => current ? { ...current, [key]: value } : current)
  }

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!settingsForm) return
    const limits = Object.fromEntries(
      previewLimitFields.map(({ key }) => [key, Number(settingsForm[key])]),
    ) as PreviewLimits
    if (previewLimitFields.some(({ key }) => !Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > 1024)) {
      showToast('error', '预览上限必须是 1 到 1024 之间的整数')
      return
    }

    setSettingsSaving(true)
    try {
      await window.remoteFiles.savePreviewLimits(limits)
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
      await window.remoteFiles.saveProfile(input)
      await refreshProfiles()
      setDialog(null)
      clearToast()
    } catch (error) {
      showToast('error', errorMessage(error))
    }
  }

  const removeProfile = async (profile: ServerProfile) => {
    if (!window.confirm('删除“' + profile.name + '”的连接配置？')) return
    try {
      await window.remoteFiles.deleteProfile(profile.id)
      onProfileDeleted(profile.id)
      await refreshProfiles()
    } catch (error) {
      showToast('error', errorMessage(error))
    }
  }

  const closeProfileDialog = () => setDialog(null)
  const closeSettingsDialog = () => setSettingsForm(null)

  return {
    profiles,
    profileDialog: dialog,
    settingsForm,
    settingsLoading,
    settingsSaving,
    openProfileDialog,
    openSettingsDialog,
    updateProfileForm,
    submitProfile,
    removeProfile,
    updateSettingsForm,
    submitSettings,
    closeProfileDialog,
    closeSettingsDialog,
  }
}
