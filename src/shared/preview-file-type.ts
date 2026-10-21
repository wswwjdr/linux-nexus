import type { PreviewExtensions, PreviewType } from './types'

export const previewTypeLabels: Record<PreviewType, string> = {
  text: '文本预览',
  markdown: 'Markdown 预览',
  pdf: 'PDF 预览',
  image: '图片预览',
  audio: '音频预览',
  video: '视频预览',
}

export const DEFAULT_PREVIEW_EXTENSIONS: PreviewExtensions = {
  text: [
    'txt', 'text', 'log', 'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'psm1', 'psd1', 'vbs',
    'md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdx', 'rst', 'adoc',
    'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config', 'cfg', 'env', 'properties', 'service', 'desktop',
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'xml', 'svg', 'csv', 'tsv', 'sql',
    'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'java', 'kt', 'kts', 'go', 'rs', 'py', 'pyw',
    'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'php', 'rb', 'swift', 'scala', 'lua', 'pl',
    'r', 'ex', 'exs', 'erl', 'hrl', 'hs', 'ml', 'fs', 'dart', 'graphql', 'gql', 'proto', 'gradle', 'lock', 'tex',
  ],
  markdown: ['md', 'markdown', 'mdown', 'mkdn', 'mkd', 'mdwn', 'mdx'],
  pdf: ['pdf'],
  image: ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'avif', 'ico', 'svg'],
  audio: ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'weba'],
  video: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
}

export const previewTypes: readonly PreviewType[] = ['text', 'markdown', 'pdf', 'image', 'audio', 'video']

export function normalizePreviewExtension(value: string): string {
  const extension = value.trim().toLowerCase().replace(/^\.+/, '')
  if (extension.length > 64 || !/^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/.test(extension)) {
    throw new Error('文件后缀格式无效：' + value)
  }
  return '.' + extension
}

export function previewFileTypes(fileName: string, previewExtensions: PreviewExtensions): PreviewType[] {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase()
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === name.length - 1) return []
  return previewTypes.filter((type) => previewExtensions[type].some((extension) =>
    name.endsWith(normalizePreviewExtension(extension))))
}
