import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { PreviewResult } from '@shared/types'
import { registerLocalPreviewAsset } from '../preview-assets'
import { previewSizeError, previewUrl, type PreviewStrategy } from '../preview-strategy'

type ImagePreviewResult = Extract<PreviewResult, { type: 'image' }>

export const imagePreviewStrategy: PreviewStrategy<ImagePreviewResult> = {
  types: ['image'],
  async preview({ sftp, remotePath, name, limitBytes, limitMiB }) {
    const token = randomUUID()
    const extension = extname(remotePath).toLowerCase()
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
        sftp.createReadStream(remotePath),
        limiter,
        createWriteStream(filePath, { flags: 'wx' }),
      )
    } catch (error) {
      await unlink(filePath).catch(() => undefined)
      throw error
    }
    registerLocalPreviewAsset(token, filePath)
    return { type: 'image', name, url: previewUrl(token, name), token }
  },
}
