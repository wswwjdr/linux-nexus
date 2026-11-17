import type { RemoteFilesApi, RemoteFilesTransport } from '@shared/types'

declare global {
  interface Window {
    remoteFiles: RemoteFilesApi
    remoteFilesTransport: RemoteFilesTransport
  }
}

export {}
