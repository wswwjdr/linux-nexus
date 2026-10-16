import type { SFTPWrapper } from 'ssh2'
import type { LogPreviewPage } from '@shared/types'
import { sessions } from '../runtime'
import { readPreviewLimits } from '../state-store'
import { fileType, normalizedRemotePath, sftpLstat } from '../sftp-utils'

const LOG_PREVIEW_PAGE_BYTES = 256 * 1024

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
    name: normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1),
    content,
    startOffset,
    fileSize,
    limitBytes,
    hasEarlier: startOffset > 0 && fileSize - startOffset < limitBytes,
  }
}
