import { type MessageValue, msg } from './i18n/messages'
import type { FileTypeExtensions, PreviewType } from './file-type-registry'
import { classifyFileTypeCategories, fileTypeDefinition, fileTypeRegistry } from './file-type-registry'

export const previewTypeLabels: Record<PreviewType, MessageValue> = {
  text: msg('errors.textPreview'),
  markdown: msg('errors.markdownPreview'),
  pdf: msg('errors.pdfPreview'),
  image: msg('errors.imagePreview'),
  audio: msg('errors.audioPreview'),
  video: msg('errors.videoPreview'),
}

export const previewTypes: readonly PreviewType[] = [...new Set(fileTypeRegistry.flatMap(({ previews }) => previews))]

export function previewTypesForFile(fileName: string, extensionsByCategory: FileTypeExtensions): PreviewType[] {
  const categories = classifyFileTypeCategories(fileName, extensionsByCategory)
  return [...new Set(categories.flatMap((category) => fileTypeDefinition(category).previews))]
}

export const fileTypeMessages = {
  text: { label: msg('errors.text'), description: msg('errors.textPreviewReversePreview') },
  markdown: { label: 'Markdown', description: msg('errors.markdownPreview') },
  pdf: { label: 'PDF', description: msg('errors.pdfPreview') },
  image: { label: msg('previews.image'), description: msg('errors.imagePreview') },
  audio: { label: msg('previews.audio'), description: msg('errors.audioPreview') },
  video: { label: msg('previews.video'), description: msg('errors.videoPreview') },
  script: { label: msg('errors.script'), description: msg('errors.runEditAndRun') },
}
