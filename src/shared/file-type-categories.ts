import type { FileTypeCategory, FileTypeExtensions } from './types'

export const fileTypeCategoryLabels: Record<FileTypeCategory, string> = {
  text: '文本',
  markdown: 'Markdown',
  pdf: 'PDF',
  image: '图片',
  audio: '音频',
  video: '视频',
}

export const fileTypeCategories: readonly FileTypeCategory[] = ['text', 'markdown', 'pdf', 'image', 'audio', 'video']

export const DEFAULT_FILE_TYPE_EXTENSIONS: FileTypeExtensions = {
  text: [
    'txt', 'log', 'sh', 'bash', 'md', 'json', 'yaml', 'yml', 'toml', 'ini',
    'conf', 'config', 'env', 'html', 'css', 'xml', 'sql', 'py', 'js', 'lua',
  ],
  markdown: ['md', 'markdown'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg'],
  audio: ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'weba'],
  video: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
}

export function normalizeFileTypeExtension(value: string): string {
  const extension = value.trim().toLowerCase().replace(/^\.+/, '')
  if (extension.length > 64 || !/^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/.test(extension)) {
    throw new Error('文件后缀格式无效：' + value)
  }
  return '.' + extension
}

export function classifyFileTypeCategories(fileName: string, extensionsByCategory: FileTypeExtensions): FileTypeCategory[] {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === name.length - 1) return []
  return fileTypeCategories.filter((category) => extensionsByCategory[category].some((extension) =>
    name.endsWith(normalizeFileTypeExtension(extension))))
}
