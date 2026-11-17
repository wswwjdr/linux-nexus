import { randomUUID } from 'node:crypto'
import type { PreviewResult } from '@shared/types'
import { registerMarkdownResources } from '../preview-assets'
import type { PreviewStrategy } from '../preview-strategy'
import { decodeText, detectTextLineEnding } from '../text-codec'
import { readVersionedTextBytes } from '../versioned-text'

type TextPreviewResult = Extract<PreviewResult, { type: 'text' | 'markdown' }>

export const textPreviewStrategy: PreviewStrategy<TextPreviewResult> = {
  types: ['text', 'markdown'],
  /**
   * Builds a preview from a verified snapshot of the remote file.
   * @param request Preview type, source, byte limit and optional read encoding.
   * @returns Text with its editing metadata, or Markdown with a resource URL.
   */
  async preview({ type, sessionId, profileId, client, remotePath, name, limitBytes, encoding }) {
    const { bytes, version } = await readVersionedTextBytes(client, remotePath, limitBytes)
    const decoded = decodeText(bytes, encoding)
    if (type === 'markdown') {
      const token = randomUUID()
      registerMarkdownResources(token, sessionId, profileId)
      return { type, name, content: decoded.content, token,
        resourceBaseUrl: 'remote-preview://' + token + remotePath.split('/').map(encodeURIComponent).join('/') }
    }
    return { type: 'text', name, ...decoded, version, lineEnding: detectTextLineEnding(decoded.content) }
  },
}
