import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionClosedEvent,
  DownloadProgress,
  RemoteFilesApi,
  SaveProfileInput,
  TrustHostKeyInput,
} from '@shared/types'

const api: RemoteFilesApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (input: SaveProfileInput) => ipcRenderer.invoke('profiles:save', input),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (profileId: string) => ipcRenderer.invoke('connection:connect', profileId),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (profileId: string) => ipcRenderer.invoke('connection:disconnect', profileId),
  listDirectory: (profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', profileId, remotePath),
  downloadFile: (requestId: string, profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:download', requestId, profileId, remotePath),
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgress) => callback(progress)
    ipcRenderer.on('files:download-progress', listener)
    return () => ipcRenderer.removeListener('files:download-progress', listener)
  },
  onConnectionClosed: (callback: (event: ConnectionClosedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ConnectionClosedEvent) => callback(event)
    ipcRenderer.on('connection:closed', listener)
    return () => ipcRenderer.removeListener('connection:closed', listener)
  },
}

contextBridge.exposeInMainWorld('remoteFiles', api)
