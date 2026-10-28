import type { Readable } from 'node:stream'
import { unlink } from 'node:fs/promises'

export type PreviewAsset =
  | { kind: 'local'; filePath: string; contentType: string }
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

export function registerLocalPreviewAsset(token: string, filePath: string, contentType: string): void {
  previewAssets.set(token, { kind: 'local', filePath, contentType })
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

function disposeRemoteAsset(asset: Extract<PreviewAsset, { kind: 'remote' }>): void {
  for (const stream of asset.activeStreams) stream.destroy()
}

function disposeLocalAsset(asset: Extract<PreviewAsset, { kind: 'local' }>): void {
  void unlink(asset.filePath).catch(() => undefined)
}

export function clearPreviewAssets(): void {
  for (const asset of previewAssets.values()) {
    if (asset.kind === 'remote') disposeRemoteAsset(asset)
    else disposeLocalAsset(asset)
  }
  previewAssets.clear()
}

export function clearPreviewAssetsForSession(sessionId: string): void {
  for (const [token, asset] of previewAssets) {
    if (asset.kind !== 'remote' || asset.sessionId !== sessionId) continue
    disposeRemoteAsset(asset)
    previewAssets.delete(token)
  }
}

export async function releasePreview(token: string): Promise<void> {
  const asset = previewAssets.get(token)
  if (!asset) return
  previewAssets.delete(token)
  if (asset.kind === 'remote') {
    disposeRemoteAsset(asset)
    return
  }
  await unlink(asset.filePath).catch(() => undefined)
}
