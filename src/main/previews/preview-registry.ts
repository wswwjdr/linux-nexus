import { posix } from 'node:path'
import type { PreviewLimits, PreviewResult } from '@shared/types'
import { previewTypes, previewTypesForFile } from '@shared/preview-file-type'
import { readAppSettings } from '../state-store'
import { filesSession, normalizedRemotePath, remotePathType, remoteFileSize } from '../remote-fs'
import { imagePreviewStrategy } from './strategies/image-preview'
import { mediaPreviewStrategy } from './strategies/media-preview'
import { pdfPreviewStrategy } from './strategies/pdf-preview'
import { textPreviewStrategy } from './strategies/text-preview'
import { previewSizeError, type PreviewStrategy, type PreviewType } from './preview-strategy'

const previewLimitKeyByType: Record<PreviewType, keyof PreviewLimits> = {
  text: 'textMiB',
  markdown: 'textMiB',
  pdf: 'pdfMiB',
  image: 'imageMiB',
  audio: 'audioMiB',
  video: 'videoMiB',
}

const previewStrategies: readonly PreviewStrategy[] = [
  textPreviewStrategy,
  pdfPreviewStrategy,
  imagePreviewStrategy,
  mediaPreviewStrategy,
]

const strategyByType = new Map<PreviewType, PreviewStrategy>()
for (const strategy of previewStrategies) {
  for (const type of strategy.types) {
    if (strategyByType.has(type)) throw new Error('预览策略重复注册：' + type)
    strategyByType.set(type, strategy)
  }
}

function previewStrategyFor(type: PreviewType): PreviewStrategy {
  const strategy = strategyByType.get(type)
  if (!strategy) throw new Error('未找到预览策略：' + type)
  return strategy
}

export async function previewFile(sessionId: string, remotePath: string, type: PreviewType): Promise<PreviewResult> {
  const session = filesSession(sessionId)
  if (!previewTypes.includes(type)) throw new Error('预览类型无效')
  const normalizedPath = normalizedRemotePath(remotePath)
  const settings = readAppSettings()
  if (!previewTypesForFile(normalizedPath, settings.fileTypeExtensions).includes(type)) {
    throw new Error('此文件未配置该预览类型')
  }
  if (await remotePathType(session.client, normalizedPath) !== 'file') throw new Error('只能预览普通文件')

  const limits: PreviewLimits = settings
  const limitMiB = limits[previewLimitKeyByType[type]]
  const limitBytes = limitMiB * 1024 * 1024
  const size = await remoteFileSize(session.client, normalizedPath)
  if (size > limitBytes) throw previewSizeError(limitMiB)

  return previewStrategyFor(type).preview({
    type,
    sessionId,
    profileId: session.profileId,
    client: session.client,
    remotePath: normalizedPath,
    name: posix.basename(normalizedPath),
    size,
    limitBytes,
    limitMiB,
  })
}
