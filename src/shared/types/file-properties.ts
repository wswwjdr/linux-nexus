import type { RemoteEntry } from './profiles'

export interface RemoteEntryProperties extends RemoteEntry {
  symbolicPermissions: string
  owner: string
  uid: number
  group: string
  gid: number
  accessedAt: string
  changedAt: string
  createdAt: string | null
  linkTarget: string | null
}
