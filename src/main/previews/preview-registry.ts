import { posix } from 'node:path'
import type { PreviewLimits, PreviewResult } from '@shared/types'
import { previewFileType } from '@shared/preview-file-type'
import { sessions } from '../runtime'
import { readPreviewLimits } from '../state-store'
import { fileType, normalizedRemotePath, sftpLstat } from '../sftp-utils'
import { imagePreviewStrategy } from './strategies/image-preview'
import { mediaPreviewStrategy } from './strategies/media-preview'
import { textPreviewStrategy } from './strategies/text-preview'
import { previewSizeError, type PreviewStrategy, type PreviewType } from './preview-strategy'

const previewLimitKeyByType: Record<PreviewType, keyof PreviewLimits> = {
  text: 'textMiB',
  image: 'imageMiB',
  audio: 'audioMiB',
  video: 'videoMiB',
}

const previewStrategies: readonly PreviewStrategy[] = [
  textPreviewStrategy,
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

export async function previewFile(sessionId: string, remotePath: string): Promise<PreviewResult> {
  const session = sessions.get(sessionId)
  if (!session?.sftp) throw new Error('SFTP 会话未连接')
  const normalizedPath = normalizedRemotePath(remotePath)
  const type = previewFileType(normalizedPath)
  if (!type) throw new Error('暂不支持的文件类型')
  const attrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(attrs.mode) !== 'file') throw new Error('只能预览普通文件')

  const limits = readPreviewLimits()
  const limitMiB = limits[previewLimitKeyByType[type]]
  const limitBytes = limitMiB * 1024 * 1024
  const size = attrs.size ?? 0
  if (size > limitBytes) throw previewSizeError(limitMiB)

  return previewStrategyFor(type).preview({
    type,
    sessionId,
    profileId: session.profileId,
    sftp: session.sftp,
    remotePath: normalizedPath,
    name: posix.basename(normalizedPath),
    size,
    limitBytes,
    limitMiB,
  })
}
