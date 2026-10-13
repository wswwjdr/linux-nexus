import type { BrowserWindow } from 'electron'
import type { Readable } from 'node:stream'
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'

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

export type PreviewAsset =
  | { kind: 'local'; filePath: string }
  | { kind: 'remote'; sessionId: string; profileId: string; sftp: SFTPWrapper; remotePath: string; size: number; activeStreams: Set<Readable> }

export const sessions = new Map<string, ActiveSession>()
export const previewAssets = new Map<string, PreviewAsset>()
export const activeTransfers = new Map<string, ActiveTransfer>()

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function clearPreviewAssets(): void {
  for (const asset of previewAssets.values()) {
    if (asset.kind === 'remote') {
      for (const stream of asset.activeStreams) stream.destroy()
    }
  }
  previewAssets.clear()
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
