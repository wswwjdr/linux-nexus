import { msg, LocalizedError } from '../shared/i18n/messages'
import { posix } from 'node:path'
import type { RemoteDirectoryStats, RemoteEntryProperties } from '@shared/types'
import { filesSession, normalizedRemotePath } from './remote-fs'
import { runRemoteCommand } from './ssh-commands'

const commandOptions = { timeoutMs: 30_000, maxStdoutBytes: 1024 * 1024 }

function invalidProperties(): never {
  throw new LocalizedError(msg('errors.serverReturnedInvalidFileProperties'))
}

function integer(value: string, nonnegative = true): number {
  if (!(nonnegative ? /^\d+$/ : /^-?\d+$/).test(value)) invalidProperties()
  const result = Number(value)
  if (!Number.isSafeInteger(result)) invalidProperties()
  return result
}

function timestamp(value: string): string {
  const date = new Date(integer(value, false) * 1000)
  if (!Number.isFinite(date.getTime())) invalidProperties()
  return date.toISOString()
}

export async function getRemoteEntryProperties(sessionId: string, remotePath: string): Promise<RemoteEntryProperties> {
  const session = filesSession(sessionId)
  const path = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(session.commands, [
    'set -eu',
    'export LC_ALL=C',
    'stat --printf=\'%f\\0%s\\0%a\\0%A\\0%u\\0%U\\0%g\\0%G\\0%X\\0%Y\\0%Z\\0%W\\0\' -- "$1"',
    'if [[ -L "$1" ]]; then readlink --zero -- "$1"; else printf "\\0"; fi',
  ].join('\n'), [path], commandOptions)
  const fields = stdout.toString('utf8').split('\0')
  if (fields.length !== 14 || fields.pop() !== '') invalidProperties()
  const [mode, size, permissions, symbolicPermissions, uid, owner, gid, group, accessed, modified, changed, created, target] = fields
  if (!/^[\da-f]{1,4}$/i.test(mode) || !/^[0-7]{1,4}$/.test(permissions)
    || !/^[bcdlps-][rwxStTs-]{9}$/.test(symbolicPermissions) || !owner || !group) invalidProperties()
  const kind = Number.parseInt(mode, 16) & 0xf000
  const type = kind === 0x4000 ? 'directory' : kind === 0x8000 ? 'file' : kind === 0xa000 ? 'symlink' : 'other'
  if ((type === 'symlink' && !target) || (type !== 'symlink' && target !== '')) invalidProperties()
  return {
    name: posix.basename(path) || '/', path, type,
    size: integer(size), permissions: permissions.padStart(3, '0'), symbolicPermissions,
    uid: integer(uid), owner, gid: integer(gid), group,
    accessedAt: timestamp(accessed), modifiedAt: timestamp(modified), changedAt: timestamp(changed),
    createdAt: integer(created, false) === 0 ? null : timestamp(created),
    linkTarget: type === 'symlink' ? target : null,
  }
}

export async function getRemoteDirectoryStats(sessionId: string, remotePath: string): Promise<RemoteDirectoryStats> {
  const session = filesSession(sessionId)
  const path = normalizedRemotePath(remotePath)
  const { stdout } = await runRemoteCommand(session.commands, String.raw`set -euo pipefail
export LC_ALL=C
[[ ! -L "$1" && -d "$1" ]] || { printf '%s\n' 'LINUX_NEXUS_DIAGNOSTIC:directoryStatsType' >&2; exit 1; }
usage=$(du -P -s -B1 -- "$1")
IFS=$'\t' read -r bytes _ <<< "$usage"
counts=$(find -P -- "$1" -mindepth 1 -type d -printf 'd\n' -o -type f -printf 'f\n' |
  awk '/^d$/ { directories++ } /^f$/ { files++ } END { printf "%.0f\t%.0f", directories, files }')
printf '%s\t%s\n' "$bytes" "$counts"
`, [path], commandOptions)

  const fields = /^(\d+)\t(\d+)\t(\d+)\n$/.exec(stdout.toString('utf8'))
  const values = fields?.slice(1).map(Number)
  if (!values?.every(Number.isSafeInteger)) throw new LocalizedError(msg('errors.serverReturnedInvalidDirectoryStats'))
  const [allocatedBytes, directoryCount, fileCount] = values
  return { allocatedBytes, directoryCount, fileCount }
}
