import type { RemoteFilesApi, RemoteFilesTransport } from '@shared/types'
import type { UpdateTransport } from '@shared/types/updates'

declare global {
  interface Window {
    remoteFiles: RemoteFilesApi
    remoteFilesTransport: RemoteFilesTransport
    appUpdates?: UpdateTransport
  }
}

export {}
