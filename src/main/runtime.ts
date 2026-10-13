import type { BrowserWindow } from 'electron'
import type { Client, SFTPWrapper } from 'ssh2'

export interface ActiveSession {
  client: Client
  sftp: SFTPWrapper
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
  profileId: string
  controller: AbortController
  settled: Promise<void>
}

export const sessions = new Map<string, ActiveSession>()
export const previewAssets = new Map<string, string>()
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
