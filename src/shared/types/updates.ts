import type { IpcResult, MessageValue } from '../i18n/messages'

export interface UpdateState {
  currentVersion: string
  status: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing' | 'check-failed'
  nextVersion?: string
  progress?: number
  error?: MessageValue
}

export interface UpdateTransport {
  snapshot(): Promise<IpcResult<UpdateState>>
  check(): Promise<IpcResult<void>>
  download(): Promise<IpcResult<void>>
  install(): Promise<IpcResult<void>>
  subscribe(callback: (state: UpdateState) => void): () => void
}
