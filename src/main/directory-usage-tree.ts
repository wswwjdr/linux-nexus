import { posix } from 'node:path'
import type { RemoteDirectoryUsageNode } from '@shared/types'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { filesSession, normalizedRemotePath } from './remote-fs'
import { runRemoteCommand } from './ssh-commands'

const activeScans = new Map<string, AbortController>()

function scanId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value)) {
    throw new LocalizedError(msg('errors.invalidDirectoryUsageRequest'))
  }
  return value
}

function invalidTree(): never {
  throw new LocalizedError(msg('errors.invalidDirectoryUsageTree'))
}

function unsigned(value: string): number {
  const number = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) invalidTree()
  return number
}

export function cancelRemoteDirectoryUsageTree(requestId: unknown): boolean {
  const controller = activeScans.get(scanId(requestId))
  if (!controller) return false
  controller.abort()
  return true
}

export async function getRemoteDirectoryUsageTree(sessionId: string, remotePath: string, requestId: unknown, entryLimit: number): Promise<RemoteDirectoryUsageNode[]> {
  const id = scanId(requestId)
  if (activeScans.has(id)) throw new LocalizedError(msg('errors.directoryUsageAlreadyRunning'))
  const { commands } = filesSession(sessionId)
  const path = normalizedRemotePath(remotePath)
  const controller = new AbortController()
  activeScans.set(id, controller)
  try {
    return await commands.track(scanDirectory(path, commands, controller.signal, entryLimit))
  } finally {
    activeScans.delete(id)
  }
}

async function scanDirectory(path: string, commands: ReturnType<typeof filesSession>['commands'], signal: AbortSignal, entryLimit: number): Promise<RemoteDirectoryUsageNode[]> {
  const nodes: RemoteDirectoryUsageNode[] = []
  const ancestors: number[] = []
  const paths = new Set<string>()
  const inodes = new Map<string, number>()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  let partial: Buffer = Buffer.alloc(0)
  let fields: string[] = []

  const addNode = () => {
    if (nodes.length > entryLimit) throw new LocalizedError(msg('errors.directoryUsageTreeLimit', { limit: entryLimit }))
    const [rawDepth, name, kind, blocks, device, inode, links] = fields
    const depth = unsigned(rawDepth)
    const allocatedBytes = unsigned(blocks) * 512
    const linkCount = unsigned(links)
    if (!Number.isSafeInteger(allocatedBytes) || !/^\d+$/.test(device) || !/^\d+$/.test(inode)
      || !linkCount || !['d', 'f', 'l', 'b', 'c', 'p', 's'].includes(kind)) invalidTree()
    const type = kind === 'd' ? 'directory' : kind === 'f' ? 'file' : kind === 'l' ? 'symlink' : 'other'
    if (nodes.length === 0) {
      if (depth !== 0 || type !== 'directory' || name !== (posix.basename(path) || '/')) invalidTree()
    } else if (depth === 0 || depth > ancestors.length || !name || name === '.' || name === '..' || name.includes('/')) {
      invalidTree()
    }
    const parentIndex = depth === 0 ? null : ancestors[depth - 1]
    if (parentIndex !== null && nodes[parentIndex].type !== 'directory') invalidTree()
    const pathKey = `${parentIndex}/${name}`
    if (paths.has(pathKey)) invalidTree()
    paths.add(pathKey)

    let sharedAllocation = false
    if (type !== 'directory' && linkCount > 1) {
      const inodeKey = `${device}:${inode}`
      const previous = inodes.get(inodeKey)
      if (previous === undefined) inodes.set(inodeKey, allocatedBytes)
      else {
        if (previous !== allocatedBytes) invalidTree()
        sharedAllocation = true
      }
    }
    ancestors.length = depth
    ancestors.push(nodes.length)
    nodes.push({ parentIndex, name, type, allocatedBytes, sharedAllocation })
  }

  await runRemoteCommand(commands, String.raw`set -eu
export LC_ALL=C
[[ ! -L "$1" && -d "$1" ]] || { printf '%s\n' 'LINUX_NEXUS_DIAGNOSTIC:directoryStatsType' >&2; exit 1; }
exec find -P -- "$1" -printf '%d\0%f\0%y\0%b\0%D\0%i\0%n\0'
`, [path], {
    signal, timeoutMs: null, maxStdoutBytes: Math.max(64 * 1024 * 1024, 512 * (entryLimit + 1)), collectStdout: false,
    onStdout(chunk) {
      const input = partial.length ? Buffer.concat([partial, chunk]) : chunk
      let start = 0
      for (let end = input.indexOf(0); end !== -1; end = input.indexOf(0, start)) {
        if (end - start > 4096) invalidTree()
        let field: string
        try { field = decoder.decode(input.subarray(start, end)) } catch { invalidTree() }
        fields.push(field)
        start = end + 1
        if (fields.length === 7) {
          addNode()
          fields = []
        }
      }
      partial = input.subarray(start)
      if (partial.length > 4096) invalidTree()
    },
  })
  if (signal.aborted || commands.signal.aborted) throw new LocalizedError(msg('errors.remoteCommandCancelled'))
  if (partial.length || fields.length || !nodes.length) invalidTree()
  for (let index = nodes.length - 1; index > 0; index--) {
    const { parentIndex, allocatedBytes, sharedAllocation } = nodes[index]
    if (sharedAllocation) continue
    const parent = nodes[parentIndex!]
    parent.allocatedBytes += allocatedBytes
    if (!Number.isSafeInteger(parent.allocatedBytes)) invalidTree()
  }
  return nodes
}
