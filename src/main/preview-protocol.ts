import { session } from 'electron'
import { createReadStream as localCreateReadStream } from 'node:fs'
import { stat as localStat } from 'node:fs/promises'
import { PassThrough, Readable } from 'node:stream'
import { once } from 'node:events'
import { sessions } from './runtime'
import { getPreviewAsset } from './previews/preview-assets'
import { runRemoteCommand } from './ssh-commands'

export function registerPreviewProtocol(): void {
  session.defaultSession.protocol.handle('remote-preview', async (request) => {
    const token = new URL(request.url).hostname
    const asset = getPreviewAsset(token)
    if (!asset) return new Response(null, { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const remoteSession = asset.kind === 'remote' ? sessions.get(asset.sessionId) : null
    if (asset.kind === 'remote' && (!remoteSession || remoteSession.kind !== 'files' || remoteSession.profileId !== asset.profileId)) {
      return new Response(null, { status: 503 })
    }
    const size = asset.kind === 'local' ? (await localStat(asset.filePath)).size : asset.size
    const headers = new Headers({
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
            if (!writable.write(chunk)) await once(writable, 'drain')
          },
        },
      ).then(() => (source as PassThrough).end(), (error: unknown) => (source as PassThrough).destroy(error instanceof Error ? error : new Error(String(error))))
    }
    return new Response(Readable.toWeb(source) as unknown as BodyInit, { status, headers })
  })
}
