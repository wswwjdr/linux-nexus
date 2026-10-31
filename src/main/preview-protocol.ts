import { session } from 'electron'
import { createReadStream as localCreateReadStream } from 'node:fs'
import { stat as localStat } from 'node:fs/promises'
import { PassThrough, Readable } from 'node:stream'
import { waitForDrain } from './stream-utils'
import { sessions } from './runtime'
import { getPreviewAsset } from './previews/preview-assets'
import { runRemoteCommand } from './ssh-commands'
import { normalizedRemotePath, remoteFileSize, remotePathType } from './remote-fs'
import { readAppSettings } from './state-store'
import { previewTypesForFile } from '@shared/preview-file-type'
import { previewMimeType } from '@shared/preview-mime-type'

export function registerPreviewProtocol(): void {
  session.defaultSession.protocol.handle('remote-preview', previewResponse)
}

export async function previewResponse(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const token = url.hostname
  const registered = getPreviewAsset(token)
  if (!registered) return new Response(null, { status: 404 })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  }

  const remoteSession = registered.kind !== 'local' ? sessions.get(registered.sessionId) : null
  if (registered.kind !== 'local' && (!remoteSession || remoteSession.kind !== 'files' || remoteSession.profileId !== registered.profileId)) {
    return new Response(null, { status: 503 })
  }
  let asset: Exclude<typeof registered, { kind: 'markdown' }>
  if (registered.kind === 'markdown') {
    let remotePath: string
    try { remotePath = normalizedRemotePath(decodeURIComponent(url.pathname)) }
    catch { return new Response(null, { status: 400 }) }
    const settings = readAppSettings()
    if (!previewTypesForFile(remotePath, settings.fileTypeExtensions).includes('image')) return new Response(null, { status: 415 })
    try {
      if (await remotePathType(remoteSession!.client, remotePath) !== 'file') return new Response(null, { status: 404 })
      const size = await remoteFileSize(remoteSession!.client, remotePath)
      if (size > settings.imageMiB * 1024 * 1024) return new Response(null, { status: 413 })
      // A document can close or disconnect while metadata is being read.
      if (getPreviewAsset(token) !== registered || sessions.get(registered.sessionId) !== remoteSession) return new Response(null, { status: 404 })
      asset = { ...registered, kind: 'remote', remotePath, size, contentType: previewMimeType('image', remotePath) }
    } catch { return new Response(null, { status: 502 }) }
  } else asset = registered
  const size = asset.kind === 'local' ? (await localStat(asset.filePath)).size : asset.size
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'Content-Type': asset.contentType,
  })
  const rangeHeader = request.headers.get('range')
  let range: { start: number; end: number } | null = null
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match || size === 0 || (!match[1] && !match[2])) {
      headers.set('Content-Range', 'bytes */' + size)
      headers.set('Content-Length', '0')
      return new Response(null, { status: 416, headers })
    }
    if (!match[1]) {
      const suffixLength = Number(match[2])
      if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
        headers.set('Content-Range', 'bytes */' + size)
        headers.set('Content-Length', '0')
        return new Response(null, { status: 416, headers })
      }
      range = { start: Math.max(0, size - suffixLength), end: size - 1 }
    } else {
      const start = Number(match[1])
      const requestedEnd = match[2] ? Number(match[2]) : size - 1
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd)
        || start >= size || requestedEnd < start) {
        headers.set('Content-Range', 'bytes */' + size)
        headers.set('Content-Length', '0')
        return new Response(null, { status: 416, headers })
      }
      range = { start, end: Math.min(requestedEnd, size - 1) }
    }
    headers.set('Content-Range', 'bytes ' + range.start + '-' + range.end + '/' + size)
    headers.set('Content-Length', String(range.end - range.start + 1))
  } else {
    headers.set('Content-Length', String(size))
  }

  const status = range ? 206 : 200
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  const readOptions = range ? { start: range.start, end: range.end } : undefined
  const source = asset.kind === 'local' ? localCreateReadStream(asset.filePath, readOptions) : new PassThrough()
  const controller = new AbortController()
  const abortSource = () => {
    controller.abort()
    source.destroy()
  }
  source.once('close', () => {
    controller.abort()
    request.signal.removeEventListener('abort', abortSource)
    if (asset.kind === 'remote') asset.activeStreams.delete(source)
  })
  if (asset.kind === 'remote') {
    asset.activeStreams.add(source)
  }
  if (request.signal.aborted) abortSource()
  else request.signal.addEventListener('abort', abortSource, { once: true })
  if (asset.kind === 'remote' && remoteSession) {
    const start = range?.start ?? 0
    const length = range ? range.end - range.start + 1 : size
    void runRemoteCommand(remoteSession.client,
      'dd if="$1" iflag=skip_bytes,count_bytes skip="$2" count="$3" status=none',
      [asset.remotePath, String(start), String(length)],
      {
        signal: controller.signal,
        collectStdout: false,
        onStdout: async (chunk) => {
          const writable = source as PassThrough
          if (!writable.write(chunk)) await waitForDrain(writable, controller.signal)
        },
      },
    ).then(() => (source as PassThrough).end(), (error: unknown) => (source as PassThrough).destroy(error instanceof Error ? error : new Error(String(error))))
  }
  return new Response(Readable.toWeb(source) as unknown as BodyInit, { status, headers })
}
