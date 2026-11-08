import { msg, LocalizedError } from '../../shared/i18n/messages'
import type { RemoteCommandTarget } from '../ssh-commands'
import type { PreviewResult, TextEncoding } from '@shared/types'

export type PreviewType = PreviewResult['type']

export interface PreviewRequest {
  type: PreviewType
  sessionId: string
  profileId: string
  client: RemoteCommandTarget
  remotePath: string
  name: string
  size: number
  limitBytes: number
  limitMiB: number
  encoding?: TextEncoding
}

export interface PreviewStrategy<TResult extends PreviewResult = PreviewResult> {
  readonly types: readonly PreviewType[]
  preview(request: PreviewRequest): Promise<TResult>
}

export function previewSizeError(limitMiB: number): Error {
  return new LocalizedError(msg('errors.fileExceedsThePreviewLimitMibDownloadItToView', { "limitMiB": limitMiB }))
}

export function previewUrl(token: string, name: string): string {
  return 'remote-preview://' + token + '/' + encodeURIComponent(name)
}
