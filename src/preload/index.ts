import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionClosedEvent,
  PreviewResult,
  PreviewLimits,
  RemoteFilesApi,
  SaveProfileInput,
  TransferProgress,
  TrustHostKeyInput,
} from '@shared/types'

const api: RemoteFilesApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (input: SaveProfileInput) => ipcRenderer.invoke('profiles:save', input),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (profileId: string) => ipcRenderer.invoke('connection:connect', profileId),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (profileId: string) => ipcRenderer.invoke('connection:disconnect', profileId),
  getPreviewLimits: (): Promise<PreviewLimits> => ipcRenderer.invoke('settings:preview-limits:get'),
  savePreviewLimits: (limits: PreviewLimits): Promise<PreviewLimits> =>
    ipcRenderer.invoke('settings:preview-limits:save', limits),
  listDirectory: (profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', profileId, remotePath),
  uploadFiles: (requestId: string, profileId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-files', requestId, profileId, remoteDirectory),
  uploadFolder: (requestId: string, profileId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-folder', requestId, profileId, remoteDirectory),
  downloadEntry: (requestId: string, profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:download', requestId, profileId, remotePath),
  cancelTransfer: (requestId: string) => ipcRenderer.invoke('files:transfer-cancel', requestId),
  copyRemotePath: (profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:path-copy', profileId, remotePath),
  deleteRemoteEntry: (profileId: string, remotePath: string) =>
    ipcRenderer.invoke('files:delete', profileId, remotePath),
  previewFile: (profileId: string, remotePath: string): Promise<PreviewResult> =>
    ipcRenderer.invoke('files:preview', profileId, remotePath),
  releasePreview: (token: string) => ipcRenderer.invoke('files:preview-release', token),
  onTransferProgress: (callback: (progress: TransferProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TransferProgress) => callback(progress)
    ipcRenderer.on('files:transfer-progress', listener)
    return () => ipcRenderer.removeListener('files:transfer-progress', listener)
  },
  onConnectionClosed: (callback: (event: ConnectionClosedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ConnectionClosedEvent) => callback(event)
    ipcRenderer.on('connection:closed', listener)
    return () => ipcRenderer.removeListener('connection:closed', listener)
  },
}

contextBridge.exposeInMainWorld('remoteFiles', api)
