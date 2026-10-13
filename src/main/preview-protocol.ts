import { session } from 'electron'
import { createReadStream as localCreateReadStream } from 'node:fs'
import { stat as localStat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { previewAssets } from './runtime'

export function registerPreviewProtocol(): void {
  session.defaultSession.protocol.handle('remote-preview', async (request) => {
    const token = new URL(request.url).hostname
    const filePath = previewAssets.get(token)
    if (!filePath) return new Response(null, { status: 404 })
    const { size } = await localStat(filePath)
    const extension = extname(filePath).toLowerCase()
    const contentType: Record<string, string> = {
      '.gif': 'image/gif',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.mp3': 'audio/mpeg',
      '.mp4': 'video/mp4',
      '.png': 'image/png',
      '.sh': 'text/plain; charset=utf-8',
      '.txt': 'text/plain; charset=utf-8',
    }
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType[extension] ?? 'application/octet-stream',
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
    const source = range
      ? localCreateReadStream(filePath, { start: range.start, end: range.end })
      : localCreateReadStream(filePath)
    request.signal.addEventListener('abort', () => source.destroy(), { once: true })
    return new Response(Readable.toWeb(source), { status, headers })
  })
}
