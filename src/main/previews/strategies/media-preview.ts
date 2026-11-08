import { msg, LocalizedError } from '../../../shared/i18n/messages'
import { randomUUID } from 'node:crypto'
import type { PreviewResult } from '@shared/types'
import { previewMimeType } from '@shared/preview-mime-type'
import { registerRemotePreviewAsset } from '../preview-assets'
import { previewUrl, type PreviewStrategy } from '../preview-strategy'

type MediaPreviewResult = Extract<PreviewResult, { type: 'audio' | 'video' }>

export const mediaPreviewStrategy: PreviewStrategy<MediaPreviewResult> = {
  types: ['audio', 'video'],
  async preview({ type, sessionId, profileId, remotePath, name, size }) {
    if (type !== 'audio' && type !== 'video') {
      throw new LocalizedError(msg('errors.mediaPreviewStrategyCannotHandleThisFileType'))
    }
    const token = randomUUID()
    registerRemotePreviewAsset(token, sessionId, profileId, remotePath, size, previewMimeType(type, remotePath))
    return { type, name, url: previewUrl(token, name), token }
  },
}
