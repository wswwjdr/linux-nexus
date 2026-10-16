import { createHash, randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { SFTPWrapper } from 'ssh2'
import type { PreviewResult, TextFileRevision, TextFileSaveResult } from '@shared/types'
import { sessions } from '../../runtime'
import { readPreviewLimits } from '../../state-store'
import { fileType, isRemoteNotFound, normalizedRemotePath, sftpLstat, sftpRename, sftpUnlink } from '../../sftp-utils'
import { previewSizeError, type PreviewStrategy } from '../preview-strategy'

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/

type TextPreviewResult = Extract<PreviewResult, { type: 'text' }>

function saveSizeError(limitMiB: number): Error {
  return new Error('保存后的文本超过 ' + limitMiB + ' MiB 上限')
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

function detectTextLineEnding(content: string): TextFileRevision['lineEnding'] {
  const lineEndings = content.match(/\r\n|\r|\n/g)
  if (!lineEndings?.length) return null
  const [lineEnding] = lineEndings
  if (lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r') return null
  return lineEndings.every((candidate) => candidate === lineEnding) ? lineEnding : null
}

function textRevision(buffer: Buffer, content = decodeText(buffer)): TextFileRevision {
  return {
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    lineEnding: detectTextLineEnding(content),
  }
}

function encodeEditedText(content: string, lineEnding: TextFileRevision['lineEnding']): Buffer {
  const normalizedContent = content.replace(/\r\n|\r/g, '\n')
  const savedContent = lineEnding && lineEnding !== '\n'
    ? normalizedContent.replace(/\n/g, lineEnding)
    : normalizedContent
  return Buffer.from(savedContent, 'utf8')
}

async function readTextFile(sftp: SFTPWrapper, remotePath: string, limitBytes: number, limitMiB: number): Promise<Buffer> {
  const stream = sftp.createReadStream(remotePath)
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
  return Buffer.concat(chunks, received)
}

function assertTextFileRevision(value: unknown): asserts value is TextFileRevision {
  if (typeof value !== 'object' || value === null
    || !('contentHash' in value)
    || typeof value.contentHash !== 'string'
    || !CONTENT_HASH_PATTERN.test(value.contentHash)
    || !('lineEnding' in value)
    || (value.lineEnding !== null && value.lineEnding !== '\n' && value.lineEnding !== '\r\n' && value.lineEnding !== '\r')) {
    throw new Error('文本版本无效，请重新打开预览')
  }
}

async function cleanupFailedTextSave(sftp: SFTPWrapper, temporaryPath: string, failure: unknown): Promise<never> {
  try {
    await sftpUnlink(sftp, temporaryPath)
  } catch (cleanupError) {
    if (!isRemoteNotFound(cleanupError)) {
      const detail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      const message = failure instanceof Error ? failure.message : String(failure)
      throw new Error(message + '；未完成的编辑临时文件无法清理 ' + temporaryPath + '：' + detail)
    }
  }
  throw failure
}

async function replaceTextFile(
  sftp: SFTPWrapper,
  destination: string,
  content: Buffer,
  mode: number | undefined,
): Promise<string | undefined> {
  const temporaryPath = posix.join(posix.dirname(destination), '.' + posix.basename(destination) + '.' + randomUUID() + '.edit')
  const backupPath = posix.join(posix.dirname(destination), '.' + posix.basename(destination) + '.' + randomUUID() + '.backup')
  try {
    await pipeline(
      Readable.from([content]),
      sftp.createWriteStream(temporaryPath, {
        flags: 'wx',
        ...(mode === undefined ? {} : { mode }),
      }),
    )
  } catch (error) {
    return cleanupFailedTextSave(sftp, temporaryPath, error)
  }

  try {
    await sftpRename(sftp, destination, backupPath)
  } catch (error) {
    return cleanupFailedTextSave(sftp, temporaryPath, error)
  }

  try {
    await sftpRename(sftp, temporaryPath, destination)
  } catch (error) {
    try {
      await sftpRename(sftp, backupPath, destination)
    } catch (restoreError) {
      const detail = restoreError instanceof Error ? restoreError.message : String(restoreError)
      return cleanupFailedTextSave(
        sftp,
        temporaryPath,
        new Error((error instanceof Error ? error.message : String(error)) + '；旧文件恢复失败，备份保留在 ' + backupPath + '：' + detail),
      )
    }
    return cleanupFailedTextSave(sftp, temporaryPath, error)
  }

  try {
    await sftpUnlink(sftp, backupPath)
    return undefined
  } catch (error) {
    if (isRemoteNotFound(error)) return undefined
    return backupPath
  }
}

export const textPreviewStrategy: PreviewStrategy<TextPreviewResult> = {
  types: ['text'],
  async preview({ sftp, remotePath, name, limitBytes, limitMiB }) {
    const content = await readTextFile(sftp, remotePath, limitBytes, limitMiB)
    const decodedContent = decodeText(content)
    return { type: 'text', name, content: decodedContent, revision: textRevision(content, decodedContent) }
  },
}

export async function saveTextFile(
  sessionId: string,
  remotePath: string,
  content: string,
  expectedRevision: unknown,
): Promise<TextFileSaveResult> {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('SFTP 会话未连接')
  if (typeof content !== 'string') throw new Error('文本内容无效')
  assertTextFileRevision(expectedRevision)

  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const normalizedPath = normalizedRemotePath(remotePath)
  const attrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(attrs.mode) !== 'file') throw new Error('只能保存普通文件')

  const limitMiB = readPreviewLimits().textMiB
  const limitBytes = limitMiB * 1024 * 1024
  const savedContent = encodeEditedText(content, expectedRevision.lineEnding)
  if (savedContent.length > limitBytes) throw saveSizeError(limitMiB)
  const current = await readTextFile(session.sftp, normalizedPath, limitBytes, limitMiB)
  if (textRevision(current).contentHash !== expectedRevision.contentHash) {
    throw new Error('服务器上的文件已发生变化，请重新打开预览后再保存')
  }

  const latestAttrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(latestAttrs.mode) !== 'file') throw new Error('服务器上的文件已发生变化，请重新打开预览后再保存')
  const mode = latestAttrs.mode === undefined ? undefined : latestAttrs.mode & 0o7777
  const backupPath = await replaceTextFile(session.sftp, normalizedPath, savedContent, mode)
  return {
    revision: textRevision(savedContent),
    ...(backupPath ? { backupPath } : {}),
  }
}
