import type { FileTypeCategory, FileTypeExtensions, PreviewType } from './types'
import { classifyFileTypeCategories } from './file-type-categories'

export const previewTypeLabels: Record<PreviewType, string> = {
  text: '文本预览',
  markdown: 'Markdown 预览',
  pdf: 'PDF 预览',
  image: '图片预览',
  audio: '音频预览',
  video: '视频预览',
}

export const previewTypes: readonly PreviewType[] = ['text', 'markdown', 'pdf', 'image', 'audio', 'video']

const previewCategoryByType: Record<PreviewType, FileTypeCategory> = {
  text: 'text',
  markdown: 'markdown',
  pdf: 'pdf',
  image: 'image',
  audio: 'audio',
  video: 'video',
}

export function previewTypesForFile(fileName: string, extensionsByCategory: FileTypeExtensions): PreviewType[] {
  const categories = classifyFileTypeCategories(fileName, extensionsByCategory)
  return previewTypes.filter((type) => categories.includes(previewCategoryByType[type]))
}
