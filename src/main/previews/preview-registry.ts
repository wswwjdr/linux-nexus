import { msg, LocalizedError } from '../../shared/i18n/messages'
import { posix } from 'node:path'
import type { PreviewLimits, PreviewResult, TextEncoding } from '@shared/types'
import { previewTypes, previewTypesForFile } from '@shared/preview-file-type'
import { readAppSettings } from '../settings-store'
import { filesSession, normalizedRemotePath, remotePathType, remoteFileSize } from '../remote-fs'
import { imagePreviewStrategy } from './strategies/image-preview'
import { mediaPreviewStrategy } from './strategies/media-preview'
import { pdfPreviewStrategy } from './strategies/pdf-preview'
import { textPreviewStrategy } from './strategies/text-preview'
import { previewSizeError, type PreviewStrategy, type PreviewType } from './preview-strategy'
import { releasePreview } from './preview-assets'
import { verifyFileOperation } from '../file-dependencies'
import type { FileCapabilityPurpose } from '../server-capabilities'

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

const previewDependencies: Record<PreviewType, FileCapabilityPurpose> = {
  audio: 'media-preview', video: 'media-preview', pdf: 'media-preview',
  image: 'image-preview', text: 'text-preview', markdown: 'markdown-preview',
}

const strategyByType = new Map<PreviewType, PreviewStrategy>()
for (const strategy of previewStrategies) {
  for (const type of strategy.types) {
    if (strategyByType.has(type)) throw new LocalizedError(msg('errors.previewStrategyRegisteredTwice', { "type": type }))
    strategyByType.set(type, strategy)
  }
}

function previewStrategyFor(type: PreviewType): PreviewStrategy {
  const strategy = strategyByType.get(type)
  if (!strategy) throw new LocalizedError(msg('errors.previewStrategyNotFound', { "type": type }))
  return strategy
}

export async function previewFile(sessionId: string, remotePath: string, type: PreviewType, encoding?: TextEncoding): Promise<PreviewResult> {
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'gbk') throw new LocalizedError(msg('errors.invalidTextEncoding'))
  const session = filesSession(sessionId)
  return session.commands.track(previewInSession(session, remotePath, type, encoding))
}

/** Checks tools and opens the requested `type` for `remotePath` within `session`, using the optional text `encoding`. */
async function previewInSession(session: ReturnType<typeof filesSession>, remotePath: string, type: PreviewType, encoding?: TextEncoding): Promise<PreviewResult> {
  if (!previewTypes.includes(type)) throw new LocalizedError(msg('errors.invalidPreviewType'))
  const normalizedPath = normalizedRemotePath(remotePath)
  const settings = readAppSettings()
  if (!previewTypesForFile(normalizedPath, settings.files.fileTypeExtensions).includes(type)) {
    throw new LocalizedError(msg('errors.thisPreviewTypeIsNotConfiguredForTheFile'))
  }
  await verifyFileOperation(session, previewDependencies[type])
  if (await remotePathType(session.commands, normalizedPath) !== 'file') throw new LocalizedError(msg('errors.onlyRegularFilesCanBePreviewed'))

  const limits: PreviewLimits = settings.files.previewLimits
  const limitMiB = limits[previewLimitKeyByType[type]]
  const limitBytes = limitMiB * 1024 * 1024
  const size = await remoteFileSize(session.commands, normalizedPath)
  if (size > limitBytes) throw previewSizeError(limitMiB)

  const result = await previewStrategyFor(type).preview({
    type,
    sessionId: session.sessionId,
    profileId: session.profileId,
    client: session.commands,
    remotePath: normalizedPath,
    name: posix.basename(normalizedPath),
    size,
    limitBytes,
    limitMiB,
    encoding,
  })
  if (session.commands.signal.aborted) {
    if ('token' in result && result.token) await releasePreview(result.token)
    session.commands.signal.throwIfAborted()
  }
  return result
}
