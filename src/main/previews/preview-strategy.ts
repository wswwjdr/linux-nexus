import type { Client } from 'ssh2'
import type { PreviewResult } from '@shared/types'

export type PreviewType = PreviewResult['type']

export interface PreviewRequest {
  type: PreviewType
  sessionId: string
  profileId: string
  client: Client
  remotePath: string
  name: string
  size: number
  limitBytes: number
  limitMiB: number
}

export interface PreviewStrategy<TResult extends PreviewResult = PreviewResult> {
  readonly types: readonly PreviewType[]
  preview(request: PreviewRequest): Promise<TResult>
}

export function previewSizeError(limitMiB: number): Error {
  return new Error('文件超过预览上限（' + limitMiB + ' MiB），请下载后查看')
}

export function previewUrl(token: string, name: string): string {
  return 'remote-preview://' + token + '/' + encodeURIComponent(name)
}
