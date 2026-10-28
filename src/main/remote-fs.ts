import { posix } from 'node:path'
import type { RemoteEntry } from '@shared/types'
import { sessions, type ActiveSession } from './runtime'
import { runRemoteCommand } from './ssh-commands'

export function filesSession(sessionId: string): ActiveSession {
  const activeSession = sessions.get(sessionId)
  if (!activeSession || activeSession.kind !== 'files') throw new Error('文件会话未连接')
  return activeSession
}

export function normalizedRemotePath(remotePath: string): string {
  if (typeof remotePath !== 'string' || !remotePath || remotePath.includes('\0')) throw new Error('远程路径无效')
  return posix.resolve('/', remotePath)
}

export interface RemoteTreeEntry {
  relativePath: string
  type: 'directory' | 'file' | 'symlink' | 'other'
  size: number
  remotePath: string
}

function nulFields(buffer: Buffer): string[] {
  const fields = buffer.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  return fields
}

function remoteType(kind: string): RemoteEntry['type'] {
  return kind === 'd' ? 'directory' : kind === 'f' ? 'file' : kind === 'l' ? 'symlink' : 'other'
}

export async function listRemoteDirectory(client: ActiveSession['client'], remotePath: string): Promise<RemoteEntry[]> {
  const normalizedPath = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(client,
    'find -- "$1" -mindepth 1 -maxdepth 1 -printf \'%f\\0%y\\0%s\\0%T@\\0%m\\0\'',
    [normalizedPath],
  )
  const fields = nulFields(stdout)
  if (fields.length % 5 !== 0) throw new Error('服务器返回的目录清单格式无效')
  const entries: RemoteEntry[] = []
  for (let offset = 0; offset < fields.length; offset += 5) {
    const [name, kind, rawSize, rawTime, rawMode] = fields.slice(offset, offset + 5)
    const timestamp = Number(rawTime)
    const mode = Number.parseInt(rawMode, 8)
    entries.push({
      name,
      path: posix.join(normalizedPath, name),
      type: remoteType(kind),
      size: Number(rawSize),
      modifiedAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : null,
      permissions: mode.toString(8).padStart(3, '0'),
    })
  }
  return entries.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1
    if (left.type !== 'directory' && right.type === 'directory') return 1
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
  })
}

export async function collectRemoteTree(
  client: ActiveSession['client'],
  remoteRoot: string,
  signal?: AbortSignal,
): Promise<RemoteTreeEntry[]> {
  const root = normalizedRemotePath(remoteRoot)
  const { stdout } = await runRemoteCommand(client,
    'find -- "$1" -mindepth 0 -printf \'%P\\0%y\\0%s\\0\'',
    [root],
    { signal },
  )
  const fields = nulFields(stdout)
  if (fields.length % 3 !== 0) throw new Error('服务器返回的文件树格式无效')
  const entries: RemoteTreeEntry[] = []
  for (let offset = 0; offset < fields.length; offset += 3) {
    const [relativePath, kind, rawSize] = fields.slice(offset, offset + 3)
    entries.push({
      relativePath,
      type: remoteType(kind),
      size: Number(rawSize),
      remotePath: relativePath ? posix.join(root, relativePath) : root,
    })
  }
  return entries
}

export async function remotePathType(client: ActiveSession['client'], remotePath: string): Promise<RemoteEntry['type']> {
  const normalizedPath = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(client,
    'if [[ -L "$1" ]]; then printf l; elif [[ -d "$1" ]]; then printf d; elif [[ -f "$1" ]]; then printf f; else printf o; fi',
    [normalizedPath],
  )
  return remoteType(stdout.toString('ascii'))
}

export async function remoteFileSize(client: ActiveSession['client'], remotePath: string): Promise<number> {
  const normalizedPath = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(client, 'stat -c %s -- "$1"', [normalizedPath])
  const size = Number(stdout.toString('ascii').trim())
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('服务器返回的文件大小无效')
  return size
}

export async function remotePathExists(client: ActiveSession['client'], remotePath: string): Promise<boolean> {
  const normalizedPath = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(client,
    'if [[ -e "$1" || -L "$1" ]]; then printf 1; else printf 0; fi',
    [normalizedPath],
  )
  return stdout.toString('ascii') === '1'
}
