import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PreviewLimits, PreviewResult } from '@shared/types'
import { previewAssets, sessions } from './runtime'
import { readPreviewLimits } from './state-store'
import { fileType, sftpLstat } from './sftp-utils'

function previewType(remotePath: string): PreviewResult['type'] | null {
  const extension = extname(remotePath).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) return 'image'
  if (['.txt', '.sh'].includes(extension)) return 'text'
  if (extension === '.mp3') return 'audio'
  if (extension === '.mp4') return 'video'
  return null
}

function previewSizeError(limitMiB: number): Error {
  return new Error('文件超过预览上限（' + limitMiB + ' MiB），请下载后查看')
}

export async function previewFile(profileId: string, remotePath: string): Promise<PreviewResult> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const type = previewType(normalizedPath)
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
    return { type, name, content: Buffer.concat(chunks).toString('utf8') }
  }

  const token = randomUUID()
  if (type === 'audio' || type === 'video') {
    previewAssets.set(token, {
      kind: 'remote',
      profileId,
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
