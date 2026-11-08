import { msg, LocalizedError } from './i18n/messages'
export const fileTypeRegistry = [
  {
    id: 'text',
    defaultExtensions: [
      'txt', 'log', 'sh', 'bash', 'md', 'json', 'yaml', 'yml', 'toml', 'ini',
      'conf', 'config', 'env', 'html', 'css', 'xml', 'sql', 'py', 'js', 'lua',
    ],
    previews: ['text'],
    menuCapabilities: ['reverse-preview'],
  },
  {
    id: 'markdown',
    defaultExtensions: ['md', 'markdown'],
    previews: ['markdown'],
    menuCapabilities: [],
  },
  {
    id: 'pdf',
    defaultExtensions: ['pdf'],
    previews: ['pdf'],
    menuCapabilities: [],
  },
  {
    id: 'image',
    defaultExtensions: ['jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'ico', 'svg'],
    previews: ['image'],
    menuCapabilities: [],
  },
  {
    id: 'audio',
    defaultExtensions: ['mp3', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'flac', 'weba'],
    previews: ['audio'],
    menuCapabilities: [],
  },
  {
    id: 'video',
    defaultExtensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov'],
    previews: ['video'],
    menuCapabilities: [],
  },
  {
    id: 'script',
    defaultExtensions: ['sh', 'bash', 'zsh', 'py'],
    previews: [],
    menuCapabilities: ['script-execution'],
  },
] as const

export type FileTypeCategory = typeof fileTypeRegistry[number]['id']
export type PreviewType = typeof fileTypeRegistry[number]['previews'][number]
export type FileTypeMenuCapability = typeof fileTypeRegistry[number]['menuCapabilities'][number]

export type FileTypeExtensions = { [Category in FileTypeCategory]: string[] }

export const DEFAULT_FILE_TYPE_EXTENSIONS: FileTypeExtensions = Object.fromEntries(
  fileTypeRegistry.map(({ id, defaultExtensions }) => [id, [...defaultExtensions]]),
) as FileTypeExtensions

export function normalizeFileTypeExtension(value: string): string {
  const extension = value.trim().toLowerCase().replace(/^\.+/, '')
  if (extension.length > 64 || !/^[a-z0-9][a-z0-9_+-]*(?:\.[a-z0-9][a-z0-9_+-]*)*$/.test(extension)) {
    throw new LocalizedError(msg('errors.invalidFileExtension', { "value": value }))
  }
  return '.' + extension
}

export function classifyFileTypeCategories(fileName: string, extensionsByCategory: FileTypeExtensions): FileTypeCategory[] {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1).toLowerCase()
  const firstDot = name.indexOf('.')
  if (firstDot < 0 || firstDot === name.length - 1) return []
  const fullSuffix = name.slice(firstDot)
  return fileTypeRegistry
    .filter(({ id }) => extensionsByCategory[id].some((extension) => normalizeFileTypeExtension(extension) === fullSuffix))
    .map(({ id }) => id)
}

export function fileTypeDefinition(category: FileTypeCategory) {
  const definition = fileTypeRegistry.find((candidate) => candidate.id === category)
  if (!definition) throw new LocalizedError(msg('errors.unregisteredFileType', { "category": category }))
  return definition
}
