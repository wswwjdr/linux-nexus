import { type IpcResult, LocalizedError } from '@shared/i18n/messages'
import type { RemoteFilesApi, RemoteFilesTransport } from '@shared/types'

// Electron strips custom Error properties at contextBridge. Unwrap on the
// renderer side so localized descriptors survive the complete IPC round trip.
export function createRemoteFilesApi(transport: RemoteFilesTransport): RemoteFilesApi {
  return Object.fromEntries(Object.entries(transport).map(([property, method]) => {
    if (property === 'getPathForFile' || property.startsWith('on')) return [property, method]
    return [property, async (...args: unknown[]) => {
      const invoke = method as (...input: unknown[]) => Promise<IpcResult<unknown>>
      const result = await invoke(...args)
      if (!result.ok) throw new LocalizedError(result.error)
      return result.value
    }]
  })) as unknown as RemoteFilesApi
}
