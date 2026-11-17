import { msg, type MessageValue } from '@shared/i18n/messages'
import { useEffect, useState, type FormEvent } from 'react'
import type { SaveProfileInput, ServerProfile } from '@shared/types'
import type { ProfileForm } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { emptyForm, errorMessage } from '@/app-utils'

interface UseProfileManagementOptions {
  showToast: (kind: ToastNotice['kind'], message: MessageValue) => void
  onProfileSaved: (profile: ServerProfile) => void
  onProfileDeleted: (profileId: string) => void
}

/** Manages saved SSH connections and their dialogs. @param options Server lifecycle callbacks. @returns Server state and actions. */
export function useProfileManagement({ showToast, onProfileSaved, onProfileDeleted }: UseProfileManagementOptions) {
  const [profiles, setProfiles] = useState<ServerProfile[]>([])
  const [profilesLoaded, setProfilesLoaded] = useState(false)
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; form: ProfileForm } | null>(null)
  const [profileDeleteDialog, setProfileDeleteDialog] = useState<ServerProfile | null>(null)
  const [profileDeleteError, setProfileDeleteError] = useState<MessageValue | null>(null)
  const [profileDeleting, setProfileDeleting] = useState(false)

  /** Refreshes the saved connection list. @returns Completion of the refresh. */
  const refreshProfiles = async () => {
    setProfiles(await window.remoteFiles.listProfiles())
  }
  useEffect(() => {
    void refreshProfiles()
      .catch((error) => showToast('error', errorMessage(error)))
      .finally(() => setProfilesLoaded(true))
  }, [showToast])
  /** Opens a connection draft. @param mode Create or edit. @param profile Existing connection when editing. */
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

  /** Updates connection input. @param patch Changed fields. */
  const updateProfileForm = (patch: Partial<ProfileForm>) => {
    setDialog((current) => (current ? { ...current, form: { ...current.form, ...patch } } : current))
  }

  /** Validates and saves a connection. @param event Form submission. @returns Completion of the save. */
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

  /** Opens deletion confirmation. @param profile Connection to delete. */
  const requestProfileDeletion = (profile: ServerProfile) => {
    setProfileDeleteError(null)
    setProfileDeleteDialog(profile)
  }

  /** Dismisses idle deletion confirmation. */
  const closeProfileDeleteDialog = () => {
    if (profileDeleting) return
    setProfileDeleteDialog(null)
    setProfileDeleteError(null)
  }

  /** Deletes the confirmed connection. @returns Completion of deletion. */
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
    } catch (error) {
      setProfileDeleteError(errorMessage(error))
    } finally {
      setProfileDeleting(false)
    }
  }

  /** Saves connection pin state. @param profileId Connection ID. @param pinned Desired pin state. @returns Completion of the update. */
  const setProfilePinned = async (profileId: string, pinned: boolean) => {
    try {
      const updatedProfile = await window.remoteFiles.setProfilePinned(profileId, pinned)
      setProfiles((current) => current.map((profile) => (profile.id === profileId ? updatedProfile : profile)))
    } catch (error) {
      showToast('error', msg('settings.couldNotUpdateServerPinState', { value1: errorMessage(error) }))
    }
  }

  /** Closes the connection editor. */
  const closeProfileDialog = () => setDialog(null)
  return {
    profiles,
    profileDataLoaded: profilesLoaded,
    profileDialog: dialog,
    profileDeleteDialog,
    profileDeleteError,
    profileDeleting,
    openProfileDialog,
    updateProfileForm,
    submitProfile,
    requestProfileDeletion,
    closeProfileDeleteDialog,
    confirmProfileDeletion,
    setProfilePinned,
    closeProfileDialog,
  }
}
