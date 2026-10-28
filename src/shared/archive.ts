export type RemoteArchiveFormat =
  | 'zip'
  | 'tar'
  | 'tar-gz'
  | 'tar-bz2'
  | 'tar-xz'
  | 'tar-zst'

const archiveSuffixes: readonly { suffix: string; format: RemoteArchiveFormat }[] = [
  { suffix: '.tar.bz2', format: 'tar-bz2' },
  { suffix: '.tar.gz', format: 'tar-gz' },
  { suffix: '.tar.xz', format: 'tar-xz' },
  { suffix: '.tar.zst', format: 'tar-zst' },
  { suffix: '.tbz2', format: 'tar-bz2' },
  { suffix: '.tgz', format: 'tar-gz' },
  { suffix: '.txz', format: 'tar-xz' },
  { suffix: '.tzst', format: 'tar-zst' },
  { suffix: '.tar', format: 'tar' },
  { suffix: '.zip', format: 'zip' },
]

export function archiveFormatForName(name: string): RemoteArchiveFormat | null {
  const lowerName = name.toLowerCase()
  return archiveSuffixes.find(({ suffix }) => lowerName.endsWith(suffix))?.format ?? null
}

export function archiveBaseName(name: string): string {
  const lowerName = name.toLowerCase()
  const match = archiveSuffixes.find(({ suffix }) => lowerName.endsWith(suffix))
  if (!match) throw new Error('不支持的压缩包格式')
  return name.slice(0, -match.suffix.length) || 'extracted'
}
