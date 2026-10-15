import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SFTPWrapper } from 'ssh2'
import type { LogPreviewPage, PreviewLimits, PreviewResult } from '@shared/types'
import { previewFileType } from '@shared/preview-file-type'
import { previewAssets, sessions } from './runtime'
import { readPreviewLimits } from './state-store'
import { fileType, normalizedRemotePath, sftpLstat } from './sftp-utils'

const LOG_PREVIEW_PAGE_BYTES = 256 * 1024

function previewSizeError(limitMiB: number): Error {
  return new Error('文件超过预览上限（' + limitMiB + ' MiB），请下载后查看')
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

export async function previewFile(sessionId: string, remotePath: string): Promise<PreviewResult> {
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const type = previewFileType(normalizedPath)
  if (!type) throw new Error('暂不支持的文件类型')
  const attrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(attrs.mode) !== 'file') throw new Error('只能预览普通文件')
  const name = posix.basename(normalizedPath)
  const limits = readPreviewLimits()
  const limitMiB = limits[(type + 'MiB') as keyof PreviewLimits]
  const limitBytes = limitMiB * 1024 * 1024
  if ((attrs.size ?? 0) > limitBytes) throw previewSizeError(limitMiB)

  if (type === 'text') {
    const stream = session.sftp.createReadStream(normalizedPath)
    const chunks: Buffer[] = []
    let received = 0
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk)
        received += buffer.length
        if (received > limitBytes) throw previewSizeError(limitMiB)
        chunks.push(buffer)
      }
    } finally {
      if (!stream.destroyed) stream.destroy()
    }
    return { type, name, content: decodeText(Buffer.concat(chunks)) }
  }

  const token = randomUUID()
  if (type === 'audio' || type === 'video') {
    previewAssets.set(token, {
      kind: 'remote',
      sessionId,
      profileId: session.profileId,
      sftp: session.sftp,
      remotePath: normalizedPath,
      size: attrs.size ?? 0,
      activeStreams: new Set(),
    })
    return { type, name, url: 'remote-preview://' + token + '/' + encodeURIComponent(name), token }
  }

  const extension = extname(normalizedPath).toLowerCase()
  const directory = join(app.getPath('temp'), 'linux-nexus-preview')
  const filePath = join(directory, token + extension)
  await mkdir(directory, { recursive: true })
  try {
    let received = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > limitBytes) callback(previewSizeError(limitMiB))
        else callback(null, chunk)
      },
    })
    await pipeline(
      session.sftp.createReadStream(normalizedPath),
      limiter,
      createWriteStream(filePath, { flags: 'wx' }),
    )
  } catch (error) {
    await unlink(filePath).catch(() => undefined)
    throw error
  }
  previewAssets.set(token, { kind: 'local', filePath })
  return { type, name, url: 'remote-preview://' + token + '/' + encodeURIComponent(name), token }
}

async function readSftpRange(sftp: SFTPWrapper, remotePath: string, startOffset: number, endOffset: number): Promise<Buffer> {
  if (startOffset >= endOffset) return Buffer.alloc(0)
  const stream = sftp.createReadStream(remotePath, { start: startOffset, end: endOffset - 1 })
  const chunks: Buffer[] = []
  let received = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.from(chunk)
      received += buffer.length
      if (received > endOffset - startOffset) throw new Error('远程文件读取范围无效')
      chunks.push(buffer)
    }
  } finally {
    if (!stream.destroyed) stream.destroy()
  }
  if (received !== endOffset - startOffset) throw new Error('日志文件已变化，请重新打开预览')
  return Buffer.concat(chunks, received)
}

function utf8ContinuationLength(buffer: Buffer): number {
  let offset = 0
  while (offset < buffer.length && (buffer[offset] & 0xc0) === 0x80) offset += 1
  return offset
}

export async function readLogPreview(
  sessionId: string,
  remotePath: string,
  beforeOffset?: number,
  snapshotSize?: number,
): Promise<LogPreviewPage> {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('SFTP 会话未连接')
  if ((beforeOffset === undefined) !== (snapshotSize === undefined)) {
    throw new Error('日志预览位置无效')
  }
  if (beforeOffset !== undefined && (!Number.isSafeInteger(beforeOffset) || beforeOffset < 0)) {
    throw new Error('日志预览位置无效')
  }
  if (snapshotSize !== undefined && (!Number.isSafeInteger(snapshotSize) || snapshotSize < 0)) {
    throw new Error('日志文件大小无效')
  }

  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const normalizedPath = normalizedRemotePath(remotePath)
  const attrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(attrs.mode) !== 'file') throw new Error('只能预览普通文件')

  const currentSize = attrs.size ?? 0
  if (!Number.isSafeInteger(currentSize) || currentSize < 0) throw new Error('日志文件大小无效')
  const fileSize = snapshotSize ?? currentSize
  if (fileSize > currentSize) throw new Error('日志文件已变化，请重新打开预览')
  const endOffset = beforeOffset ?? fileSize
  if (endOffset > fileSize) throw new Error('日志预览位置无效')

  const limitBytes = readPreviewLimits().textMiB * 1024 * 1024
  const loadedBytes = fileSize - endOffset
  const remainingBytes = limitBytes - loadedBytes
  if (remainingBytes <= 0) throw new Error('已达到文本预览上限')

  const pageBytes = Math.min(LOG_PREVIEW_PAGE_BYTES, remainingBytes, endOffset)
  const candidateStart = endOffset - pageBytes
  const range = await readSftpRange(session.sftp, normalizedPath, candidateStart, endOffset)
  let skip = 0
  if (candidateStart > 0) {
    const firstLineBreak = range.indexOf(0x0a)
    if (firstLineBreak >= 0 && firstLineBreak + 1 < range.length) {
      skip = firstLineBreak + 1
    } else {
      skip = utf8ContinuationLength(range)
    }
    if (skip >= range.length) skip = 0
  }

  let startOffset = candidateStart + skip
  let content = range.subarray(skip).toString('utf8')
  if (startOffset >= endOffset && endOffset > 0) {
    startOffset = candidateStart
    content = range.toString('utf8')
  }

  return {
    name: posix.basename(normalizedPath),
    content,
    startOffset,
    fileSize,
    limitBytes,
    hasEarlier: startOffset > 0 && fileSize - startOffset < limitBytes,
  }
}

export function clearPreviewAssetsForSession(sessionId: string): void {
  for (const [token, asset] of previewAssets) {
    if (asset.kind !== 'remote' || asset.sessionId !== sessionId) continue
    for (const stream of asset.activeStreams) stream.destroy()
    previewAssets.delete(token)
  }
}

export async function releasePreview(token: string): Promise<void> {
  const asset = previewAssets.get(token)
  if (!asset) return
  previewAssets.delete(token)
  if (asset.kind === 'local') {
    await unlink(asset.filePath).catch(() => undefined)
    return
  }
  for (const stream of asset.activeStreams) stream.destroy()
}
