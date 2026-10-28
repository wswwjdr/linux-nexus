import { randomUUID } from 'node:crypto'
import type { PreviewResult } from '@shared/types'
import { previewMimeType } from '@shared/preview-mime-type'
import { registerRemotePreviewAsset } from '../preview-assets'
import { previewUrl, type PreviewStrategy } from '../preview-strategy'

type PdfPreviewResult = Extract<PreviewResult, { type: 'pdf' }>

export const pdfPreviewStrategy: PreviewStrategy<PdfPreviewResult> = {
  types: ['pdf'],
  async preview({ sessionId, profileId, remotePath, name, size }) {
    const token = randomUUID()
    registerRemotePreviewAsset(token, sessionId, profileId, remotePath, size, previewMimeType('pdf', remotePath))
    return { type: 'pdf', name, url: previewUrl(token, name), token }
  },
}
