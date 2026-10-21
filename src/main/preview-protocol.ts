import { session } from 'electron'
import { createReadStream as localCreateReadStream } from 'node:fs'
import { stat as localStat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { sessions } from './runtime'
import { getPreviewAsset } from './previews/preview-assets'

export function registerPreviewProtocol(): void {
  session.defaultSession.protocol.handle('remote-preview', async (request) => {
    const token = new URL(request.url).hostname
    const asset = getPreviewAsset(token)
    if (!asset) return new Response(null, { status: 404 })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
    }

    const remoteSession = asset.kind === 'remote' ? sessions.get(asset.sessionId) : null
    if (asset.kind === 'remote' && (!remoteSession || remoteSession.sftp !== asset.sftp)) {
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
    const readOptions = range
      ? { start: range.start, end: range.end }
      : asset.kind === 'remote' && size > 0 ? { start: 0, end: size - 1 } : undefined
    const source = asset.kind === 'local'
      ? localCreateReadStream(asset.filePath, readOptions)
      : asset.sftp.createReadStream(asset.remotePath, readOptions)
    const abortSource = () => source.destroy()
    source.once('close', () => {
      request.signal.removeEventListener('abort', abortSource)
      if (asset.kind === 'remote') asset.activeStreams.delete(source)
    })
    if (asset.kind === 'remote') {
      asset.activeStreams.add(source)
    }
    if (request.signal.aborted) abortSource()
    else request.signal.addEventListener('abort', abortSource, { once: true })
    return new Response(Readable.toWeb(source) as unknown as BodyInit, { status, headers })
  })
}
