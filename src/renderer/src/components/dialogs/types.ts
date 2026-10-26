import type { CommandAlias, CommandAliasSnapshot, FileTypeCategory, ServerProfile, ThemeMode } from '@shared/types'
import type { FormEvent } from 'react'
import type { FileViewMode, PendingAliasHostKey, PendingHostKey, PerformanceThresholdField, ProfileForm, SettingsFieldKey, SettingsForm } from '@/app-types'

export interface DialogLayerProps {
  profileDialog: { mode: 'create' | 'edit'; form: ProfileForm } | null
  profileDeleteDialog: ServerProfile | null
  profileDeleteError: string | null
  profileDeleting: boolean
  createDirectoryDialog: { name: string } | null
  creatingDirectory: boolean
  settingsForm: SettingsForm | null
  profiles: ServerProfile[]
  pendingHostKey: PendingHostKey | null
  pendingAliasHostKey: PendingAliasHostKey | null
  aliasSnapshot: CommandAliasSnapshot | null
  aliasProfileId: string
  aliasOperationBusy: boolean
  aliasName: string
  aliasCommand: string
  aliasOverwriteConfirmation: { name: string; existingCommand: string; command: string } | null
  aliasDeleteConfirmation: CommandAlias | null
  onCloseProfile: () => void
  onCloseProfileDelete: () => void
  onConfirmProfileDelete: () => void
  onCloseCreateDirectory: () => void
  onUpdateCreateDirectoryName: (name: string) => void
  onSubmitCreateDirectory: (event: FormEvent<HTMLFormElement>) => void
  onUpdateProfile: (patch: Partial<ProfileForm>) => void
  onSubmitProfile: (event: FormEvent<HTMLFormElement>) => void
  onCloseSettings: () => void
  onUpdateSettings: (key: SettingsFieldKey, value: string) => void
  onAddFileTypeExtension: (category: FileTypeCategory, extension: string) => void
  onRemoveFileTypeExtension: (category: FileTypeCategory, extension: string) => void
  onResetFileTypeExtensions: () => void
  onUpdateDefaultView: (mode: FileViewMode) => void
  onUpdateTheme: (theme: ThemeMode) => void
  onUpdateStartupProfile: (profileId: string) => void
  onUpdateStartupKind: (kind: SettingsForm['startupKind']) => void
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
