import type { FileTypeExtensions, PreviewType } from './file-type-registry'
import { classifyFileTypeCategories, fileTypeDefinition, fileTypeRegistry } from './file-type-registry'

export const previewTypeLabels: Record<PreviewType, string> = {
  text: '文本预览',
  markdown: 'Markdown 预览',
  pdf: 'PDF 预览',
  image: '图片预览',
  audio: '音频预览',
  video: '视频预览',
}

export const previewTypes: readonly PreviewType[] = [...new Set(fileTypeRegistry.flatMap(({ previews }) => previews))]

export function previewTypesForFile(fileName: string, extensionsByCategory: FileTypeExtensions): PreviewType[] {
  const categories = classifyFileTypeCategories(fileName, extensionsByCategory)
  return [...new Set(categories.flatMap((category) => fileTypeDefinition(category).previews))]
}
