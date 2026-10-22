import type { BrowserWindow } from 'electron'
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'
export { clearPreviewAssets } from './previews/preview-assets.ts'

export interface ActiveSession {
  sessionId: string
  client: Client
  kind: 'sftp' | 'terminal'
  sftp?: SFTPWrapper
  shell?: ClientChannel
  profileId: string
}

export interface TransferItem {
  relativePath: string
  type: 'directory' | 'file'
  size: number
  localPath?: string
  remotePath?: string
}

export interface ActiveTransfer {
  sessionId: string
  profileId: string
  controller: AbortController
  settled: Promise<void>
}

export const sessions = new Map<string, ActiveSession>()
export const activeTransfers = new Map<string, ActiveTransfer>()

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
