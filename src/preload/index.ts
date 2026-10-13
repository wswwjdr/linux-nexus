import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectionClosedEvent,
  LogPreviewPage,
  PreviewResult,
  PreviewLimits,
  RemoteFilesApi,
  RemoteSearchEvent,
  RemoteSearchRequest,
  SaveProfileInput,
  TransferProgress,
  TerminalOutputEvent,
  TrustHostKeyInput,
  SessionKind,
} from '@shared/types'

const api: RemoteFilesApi = {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfile: (input: SaveProfileInput) => ipcRenderer.invoke('profiles:save', input),
  deleteProfile: (profileId: string) => ipcRenderer.invoke('profiles:delete', profileId),
  connect: (sessionId: string, profileId: string, kind: SessionKind, cols: number, rows: number, startPath: string) =>
    ipcRenderer.invoke('connection:connect', sessionId, profileId, kind, cols, rows, startPath),
  trustHostKey: (input: TrustHostKeyInput) => ipcRenderer.invoke('host-key:trust', input),
  disconnect: (sessionId: string) => ipcRenderer.invoke('connection:disconnect', sessionId),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  getPreviewLimits: (): Promise<PreviewLimits> => ipcRenderer.invoke('settings:preview-limits:get'),
  savePreviewLimits: (limits: PreviewLimits): Promise<PreviewLimits> =>
    ipcRenderer.invoke('settings:preview-limits:save', limits),
  listDirectory: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:list', sessionId, remotePath),
  searchFiles: (request: RemoteSearchRequest) => ipcRenderer.invoke('files:search', request),
  cancelSearch: (requestId: string) => ipcRenderer.invoke('files:search-cancel', requestId),
  uploadFiles: (requestId: string, sessionId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-files', requestId, sessionId, remoteDirectory),
  uploadFolder: (requestId: string, sessionId: string, remoteDirectory: string) =>
    ipcRenderer.invoke('files:upload-folder', requestId, sessionId, remoteDirectory),
  downloadEntry: (requestId: string, sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:download', requestId, sessionId, remotePath),
  cancelTransfer: (requestId: string) => ipcRenderer.invoke('files:transfer-cancel', requestId),
  createRemoteDirectory: (sessionId: string, remoteDirectory: string, name: string) =>
    ipcRenderer.invoke('files:create-directory', sessionId, remoteDirectory, name),
  copyRemotePath: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:path-copy', sessionId, remotePath),
  deleteRemoteEntry: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('files:delete', sessionId, remotePath),
  previewFile: (sessionId: string, remotePath: string): Promise<PreviewResult> =>
    ipcRenderer.invoke('files:preview', sessionId, remotePath),
  readLogPreview: (sessionId: string, remotePath: string, beforeOffset?: number, snapshotSize?: number): Promise<LogPreviewPage> =>
    ipcRenderer.invoke('files:preview-log', sessionId, remotePath, beforeOffset, snapshotSize),
  releasePreview: (token: string) => ipcRenderer.invoke('files:preview-release', token),
  onTransferProgress: (callback: (progress: TransferProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: TransferProgress) => callback(progress)
    ipcRenderer.on('files:transfer-progress', listener)
    return () => ipcRenderer.removeListener('files:transfer-progress', listener)
  },
  onSearchEvent: (callback: (event: RemoteSearchEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, searchEvent: RemoteSearchEvent) => callback(searchEvent)
    ipcRenderer.on('files:search-event', listener)
    return () => ipcRenderer.removeListener('files:search-event', listener)
  },
  onConnectionClosed: (callback: (event: ConnectionClosedEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: ConnectionClosedEvent) => callback(event)
    ipcRenderer.on('connection:closed', listener)
    return () => ipcRenderer.removeListener('connection:closed', listener)
  },
  onTerminalOutput: (callback: (event: TerminalOutputEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, output: TerminalOutputEvent) => callback(output)
    ipcRenderer.on('terminal:output', listener)
    return () => ipcRenderer.removeListener('terminal:output', listener)
  },
}

contextBridge.exposeInMainWorld('remoteFiles', api)
