import type { PreviewResult } from './types'

const previewTypes: Record<string, PreviewResult['type']> = {
  '.jpg': 'image',
  '.jpeg': 'image',
  '.png': 'image',
  '.gif': 'image',
  '.txt': 'text',
  '.sh': 'text',
  '.log': 'text',
  '.mp3': 'audio',
  '.mp4': 'video',
}

export function previewFileType(fileName: string): PreviewResult['type'] | null {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1)
  const dotIndex = name.lastIndexOf('.')
  const extension = dotIndex > 0 ? name.slice(dotIndex).toLowerCase() : ''
  return previewTypes[extension] ?? null
}
