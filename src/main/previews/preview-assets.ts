import type { Readable } from 'node:stream'
import { unlink } from 'node:fs/promises'

export type PreviewAsset =
  | { kind: 'local'; sessionId?: string; filePath: string; contentType: string; activeStreams: Set<Readable> }
  | { kind: 'markdown'; sessionId: string; profileId: string; activeStreams: Set<Readable> }
  | {
      kind: 'remote'
      sessionId: string
      profileId: string
      remotePath: string
      size: number
      contentType: string
      activeStreams: Set<Readable>
    }

const previewAssets = new Map<string, PreviewAsset>()

export function registerMarkdownResources(token: string, sessionId: string, profileId: string): void {
  previewAssets.set(token, { kind: 'markdown', sessionId, profileId, activeStreams: new Set() })
}

export function registerLocalPreviewAsset(token: string, filePath: string, contentType: string, sessionId?: string): void {
  previewAssets.set(token, { kind: 'local', sessionId, filePath, contentType, activeStreams: new Set() })
}

export function registerRemotePreviewAsset(
  token: string,
  sessionId: string,
  profileId: string,
  remotePath: string,
  size: number,
  contentType: string,
): void {
  previewAssets.set(token, {
    kind: 'remote',
    sessionId,
    profileId,
    remotePath,
    size,
    contentType,
    activeStreams: new Set(),
  })
}

export function getPreviewAsset(token: string): PreviewAsset | undefined {
  return previewAssets.get(token)
}

function disposeStreams(asset: PreviewAsset): void {
  for (const stream of asset.activeStreams) stream.destroy()
}

function disposeLocalAsset(asset: Extract<PreviewAsset, { kind: 'local' }>): void {
  void unlink(asset.filePath).catch(() => undefined)
}

export function clearPreviewAssets(): void {
  for (const asset of previewAssets.values()) {
    disposeStreams(asset)
    if (asset.kind === 'local') disposeLocalAsset(asset)
  }
  previewAssets.clear()
}

export function clearPreviewAssetsForSession(sessionId: string): void {
  for (const [token, asset] of previewAssets) {
    if (asset.sessionId !== sessionId) continue
    previewAssets.delete(token)
    disposeStreams(asset)
    if (asset.kind === 'local') disposeLocalAsset(asset)
  }
}

export async function releasePreview(token: string): Promise<void> {
  const asset = previewAssets.get(token)
  if (!asset) return
  previewAssets.delete(token)
  disposeStreams(asset)
  if (asset.kind !== 'local') return
  await unlink(asset.filePath).catch(() => undefined)
}
