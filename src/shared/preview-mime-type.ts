import type { PreviewType } from './file-type-registry'

const mimeTypeByCategoryAndExtension: Partial<Record<PreviewType, Record<string, string>>> = {
  image: {
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.ico': 'image/vnd.microsoft.icon',
    '.jpe': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  },
  audio: {
    '.aac': 'audio/aac',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.m4v': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.mp4': 'audio/mp4',
    '.mov': 'audio/quicktime',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav',
    '.weba': 'audio/webm',
    '.webm': 'audio/webm',
  },
  video: {
    '.m4a': 'video/mp4',
    '.m4v': 'video/x-m4v',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.ogg': 'video/ogg',
    '.ogv': 'video/ogg',
    '.webm': 'video/webm',
  },
}

const fallbackMimeType: Record<PreviewType, string> = {
  text: 'text/plain; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  pdf: 'application/pdf',
  image: 'image/png',
  audio: 'audio/mpeg',
  video: 'video/mp4',
}

export function previewMimeType(type: PreviewType, fileName: string): string {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1)
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase()
  return mimeTypeByCategoryAndExtension[type]?.[extension] ?? fallbackMimeType[type]
}
