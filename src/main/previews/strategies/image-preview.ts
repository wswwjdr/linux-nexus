import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import type { PreviewResult } from '@shared/types'
import { previewMimeType } from '@shared/preview-mime-type'
import { runRemoteCommand } from '../../ssh-commands'
import { registerLocalPreviewAsset } from '../preview-assets'
import { previewSizeError, previewUrl, type PreviewStrategy } from '../preview-strategy'

type ImagePreviewResult = Extract<PreviewResult, { type: 'image' }>

export const imagePreviewStrategy: PreviewStrategy<ImagePreviewResult> = {
  types: ['image'],
  async preview({ client, remotePath, name, limitBytes, limitMiB }) {
    const token = randomUUID()
    const extension = extname(remotePath).toLowerCase()
    const directory = join(app.getPath('temp'), 'linux-nexus-preview')
    const filePath = join(directory, token + extension)
    await mkdir(directory, { recursive: true })
    const output = createWriteStream(filePath, { flags: 'wx' })
    const outputDone = finished(output)
    let received = 0
    try {
      await runRemoteCommand(client, 'cat -- "$1"', [remotePath], {
        collectStdout: false,
        maxStdoutBytes: limitBytes,
        onStdout: async (chunk) => {
          received += chunk.length
          if (received > limitBytes) throw previewSizeError(limitMiB)
          if (!output.write(chunk)) await once(output, 'drain')
        },
      })
      output.end()
      await outputDone
    } catch (error) {
      output.destroy()
      await outputDone.catch(() => undefined)
      await unlink(filePath).catch(() => undefined)
      throw error
    }
    registerLocalPreviewAsset(token, filePath, previewMimeType('image', remotePath))
    return { type: 'image', name, url: previewUrl(token, name), token }
  },
}
