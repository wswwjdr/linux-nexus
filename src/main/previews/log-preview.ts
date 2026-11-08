import { msg, LocalizedError } from '../../shared/i18n/messages'
import type { LogPreviewPage } from '@shared/types'
import { readPreviewLimits } from '../state-store'
import { filesSession, normalizedRemotePath, remoteFileSize, remotePathType } from '../remote-fs'
import { runRemoteCommand } from '../ssh-commands'

const LOG_PREVIEW_PAGE_BYTES = 256 * 1024

async function readRemoteRange(client: ReturnType<typeof filesSession>['commands'], remotePath: string, startOffset: number, endOffset: number): Promise<Buffer> {
  if (startOffset >= endOffset) return Buffer.alloc(0)
  const length = endOffset - startOffset
  const { stdout } = await runRemoteCommand(client,
    'dd if="$1" iflag=skip_bytes,count_bytes skip="$2" count="$3" status=none',
    [remotePath, String(startOffset), String(length)],
    { maxStdoutBytes: length },
  )
  if (stdout.length !== length) throw new LocalizedError(msg('errors.logFileChangedReopenThePreview'))
  return stdout
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
  if (typeof sessionId !== 'string' || !sessionId) throw new LocalizedError(msg('errors.fileSessionIsNotConnected'))
  if ((beforeOffset === undefined) !== (snapshotSize === undefined)) {
    throw new LocalizedError(msg('errors.invalidLogPreviewPosition'))
  }
  if (beforeOffset !== undefined && (!Number.isSafeInteger(beforeOffset) || beforeOffset < 0)) {
    throw new LocalizedError(msg('errors.invalidLogPreviewPosition'))
  }
  if (snapshotSize !== undefined && (!Number.isSafeInteger(snapshotSize) || snapshotSize < 0)) {
    throw new LocalizedError(msg('errors.invalidLogFileSize'))
  }

  const session = filesSession(sessionId)
  const normalizedPath = normalizedRemotePath(remotePath)
  if (await remotePathType(session.commands, normalizedPath) !== 'file') throw new LocalizedError(msg('errors.onlyRegularFilesCanBePreviewed'))

  const currentSize = await remoteFileSize(session.commands, normalizedPath)
  if (!Number.isSafeInteger(currentSize) || currentSize < 0) throw new LocalizedError(msg('errors.invalidLogFileSize'))
  const fileSize = snapshotSize ?? currentSize
  if (fileSize > currentSize) throw new LocalizedError(msg('errors.logFileChangedReopenThePreview'))
  const endOffset = beforeOffset ?? fileSize
  if (endOffset > fileSize) throw new LocalizedError(msg('errors.invalidLogPreviewPosition'))

  const limitBytes = readPreviewLimits().textMiB * 1024 * 1024
  const loadedBytes = fileSize - endOffset
  const remainingBytes = limitBytes - loadedBytes
  if (remainingBytes <= 0) throw new LocalizedError(msg('errors.textPreviewLimitReached'))

  const pageBytes = Math.min(LOG_PREVIEW_PAGE_BYTES, remainingBytes, endOffset)
  const candidateStart = endOffset - pageBytes
  const range = await readRemoteRange(session.commands, normalizedPath, candidateStart, endOffset)
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
