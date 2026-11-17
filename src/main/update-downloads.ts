import { open } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

const updateDirectoryUrl = 'https://download.tcwwj.icu/linux%20nexus%20update/'
const networkTimeoutMs = 15_000
export type FetchReleaseFile = (url: string, options: RequestInit) => Promise<Response>

/**
 * Parses and validates the major version and release minute.
 * @param text UTF-8 text from the version file or bundled metadata.
 * @returns The numeric major version and sortable date string.
 */
export function parseReleaseVersion(text: string): { major: bigint; timestamp: string } {
  const match = /^(0|[1-9]\d{0,15})\.(\d{12})$/.exec(text.trim())
  if (!match) throw new Error('Invalid release version format')
  const timestamp = match[2]
  const isoMinute = `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}`
  const date = new Date(isoMinute + ':00Z')
  if (!Number.isFinite(date.getTime()) || !date.toISOString().startsWith(isoMinute)) {
    throw new Error('Invalid release version date')
  }
  return { major: BigInt(match[1]), timestamp }
}

/**
 * Compares two release versions by major version and date.
 * @param candidate The server version.
 * @param current The packaged version.
 * @returns Whether the server version is newer.
 */
export function isNewerRelease(candidate: string, current: string): boolean {
  const next = parseReleaseVersion(candidate)
  const installed = parseReleaseVersion(current)
  return next.major > installed.major || (next.major === installed.major && next.timestamp > installed.timestamp)
}

interface DownloadOptions {
  signal?: AbortSignal
  missingAllowed?: boolean
  maxBytes?: number
  onProgress?: (received: number, total: number | null) => void
  timeoutMs?: number
}

/**
 * Streams a file from the fixed release directory into a new local file.
 * @param fetchFile Fetch implementation used by the main process.
 * @param name Name of a release file selected by the updater.
 * @param path Destination file path.
 * @param options Cancellation, limits, and optional progress reporting.
 * @returns False for an allowed 404, otherwise true after the complete file is saved.
 */
export async function downloadReleaseFile(fetchFile: FetchReleaseFile, name: string, path: string, options: DownloadOptions = {}): Promise<boolean> {
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(new Error('Update download timed out')), options.timeoutMs ?? networkTimeoutMs)
  try {
    const response = await fetchFile(new URL(name, updateDirectoryUrl).href, { signal, cache: 'no-store', redirect: 'error' })
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel()
      if (response.status === 404 && options.missingAllowed) return false
      throw new Error(`${name}: unexpected HTTP response ${response.status}`)
    }
    const declared = response.headers.get('content-length')
    const encoding = response.headers.get('content-encoding')
    const total = declared !== null && (!encoding || encoding === 'identity') && /^\d+$/.test(declared) && Number.isSafeInteger(Number(declared))
      ? Number(declared) : null
    const limit = options.maxBytes ?? Infinity
    if (total !== null && total > limit) {
      await response.body.cancel()
      throw new Error(`${name}: response exceeds the size limit`)
    }
    let received = 0
    const monitor = new Transform({
      /** Counts streamed bytes and renews the inactivity timeout. */
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > limit || (total !== null && received > total)) {
          callback(new Error(`${name}: unexpected response length`))
          return
        }
        timer.refresh()
        options.onProgress?.(received, total)
        callback(null, chunk)
      },
    })
    // Electron returns a web stream at runtime. Node and DOM declarations differ in their BYOB overloads.
    await pipeline(Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>), monitor, createWriteStream(path, { flags: 'wx' }), { signal })
    if (total !== null && total !== received) throw new Error(`${name}: incomplete response`)
    return true
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Checks the DOS and PE headers before launching an installer.
 * @param path The completed installer download.
 */
export async function validateWindowsInstaller(path: string): Promise<void> {
  const file = await open(path, 'r')
  try {
    const dos = Buffer.alloc(64)
    const pe = Buffer.alloc(24)
    const header = await file.read(dos, 0, dos.length, 0)
    if (header.bytesRead !== dos.length || dos.readUInt16LE(0) !== 0x5a4d) throw new Error('Installer has no DOS header')
    const offset = dos.readUInt32LE(60)
    const result = await file.read(pe, 0, pe.length, offset)
    const characteristics = pe.readUInt16LE(22)
    if (offset < dos.length || result.bytesRead !== pe.length || pe.readUInt32LE(0) !== 0x00004550
      || !(characteristics & 0x0002) || (characteristics & 0x2000)) {
      throw new Error('Installer has no executable PE header')
    }
  } finally {
    await file.close()
  }
}
