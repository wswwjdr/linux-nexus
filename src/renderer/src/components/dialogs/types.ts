import type { useApplicationSettings } from '@/hooks/useApplicationSettings'
import { type MessageValue } from '@shared/i18n/messages'
import type { CommandAlias, CommandAliasConfirmation, CommandAliasSnapshot, ServerProfile } from '@shared/types'
import type { FormEvent } from 'react'
import type { PendingAliasHostKey, PendingHostKey, ProfileForm } from '@/app-types'

export interface DialogLayerProps {
  profileDialog: { mode: 'create' | 'edit'; form: ProfileForm } | null
  profileDeleteDialog: ServerProfile | null
  profileDeleteError: MessageValue | null
  profileDeleting: boolean
  createDirectoryDialog: { name: string } | null
  creatingDirectory: boolean
  preferences: ReturnType<typeof useApplicationSettings>
  profiles: ServerProfile[]
  pendingHostKey: PendingHostKey | null
  pendingAliasHostKey: PendingAliasHostKey | null
  aliasSnapshot: CommandAliasSnapshot | null
  aliasProfileId: string
  aliasOperationBusy: boolean
  aliasName: string
  aliasCommand: string
  aliasOverwriteConfirmation: CommandAliasConfirmation | null
  aliasDeleteConfirmation: CommandAliasConfirmation | null
  onCloseProfile: () => void
  onCloseProfileDelete: () => void
  onConfirmProfileDelete: () => void
  onCloseCreateDirectory: () => void
  onUpdateCreateDirectoryName: (name: string) => void
  onSubmitCreateDirectory: (event: FormEvent<HTMLFormElement>) => void
  onUpdateProfile: (patch: Partial<ProfileForm>) => void
  onSubmitProfile: (event: FormEvent<HTMLFormElement>) => void
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
