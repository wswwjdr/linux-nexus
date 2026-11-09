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

export interface RemoteDirectoryStats {
  allocatedBytes: number
  directoryCount: number
  fileCount: number
}

export interface RemoteDirectoryUsageNode {
  parentIndex: number | null
  name: string
  type: RemoteEntry['type']
  allocatedBytes: number
  sharedAllocation: boolean
}
