export interface ServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
}

export interface CommandAlias {
  name: string
  command: string
  removable: boolean
  removalReason: string | null
}

export interface CommandAliasSnapshot {
  profileId: string
  aliases: CommandAlias[]
  syncedAt: string | null
  status: 'unsynced' | 'synced' | 'stale'
}

export type CommandAliasOperationResult =
  | { status: 'completed'; snapshot: CommandAliasSnapshot }
  | { status: 'host-key-required'; fingerprint: string; previousFingerprint?: string }
  | { status: 'conflict'; name: string; existingCommand: string }
  | { status: 'updated-sync-failed'; message: string; snapshot: CommandAliasSnapshot }

export interface SaveProfileInput {
  profile: ServerProfile
  password?: string
}

export interface RemoteEntry {
  name: string
  path: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  modifiedAt: string | null
  permissions: string
}
