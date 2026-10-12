import type { RemoteFilesApi } from '@shared/types'

declare global {
  interface Window {
    remoteFiles: RemoteFilesApi
  }
}

export {}
