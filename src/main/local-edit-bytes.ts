import { createHash } from 'node:crypto'
import { lstat, open, unlink, type FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { LocalizedError, msg } from '../shared/i18n/messages'
import type { TextFileVersion } from '@shared/types'
import { runRemoteCommand, type RemoteCommandTarget } from './ssh-commands'
import { commitRecord } from './staged-write'
import { uniqueDownloadName } from './transfers/download'
import { TRANSFER_CHUNK_SIZE, writeAll } from './transfers/stream-transfer'
import { parseFileVersion, regularFileGuard } from './versioned-write'

export interface LocalEditRevision { hash: string; size: number }

/** Reads and hashes a stable local file, optionally passing its chunks to a consumer.
 * @param path App-managed file path.
 * @param consume Receives chunks in sequence with backpressure.
 * @returns The content revision and byte count.
 */
export async function readLocalEdit(path: string, consume?: (chunk: Buffer) => void | Promise<void>): Promise<LocalEditRevision> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of streamLocalEdit(path)) {
    hash.update(chunk)
    size += chunk.length
    await consume?.(chunk)
  }
  return { hash: hash.digest('hex'), size }
}

/** Streams a regular file and verifies it was stable before reporting EOF.
 * @param path App-managed file path.
 * @returns Verified byte stream.
 */
export async function* streamLocalEdit(path: string): AsyncGenerator<Buffer> {
  const file = await openLocalEdit(path)
  try {
    const before = await file.stat({ bigint: true })
    let size = 0
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: TRANSFER_CHUNK_SIZE })) {
      size += chunk.length
      yield chunk
    }
    const after = await lstat(path, { bigint: true })
    if (BigInt(size) !== before.size || !after.isFile() || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs) {
      throw new LocalizedError(msg('localEdit.changedAgain'))
    }
  } finally {
    await file.close()
  }
}

/** Streams the confirmed bytes and emits a remote commit record only if they still match.
 * @param path App-managed file path.
 * @param expected Revision confirmed by the user.
 * @returns Bytes followed by their commit record.
 */
export async function* streamConfirmedLocalEdit(path: string, expected: LocalEditRevision): AsyncGenerator<Buffer> {
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of streamLocalEdit(path)) {
    size += chunk.length
    if (size > expected.size) throw new LocalizedError(msg('localEdit.changedAgain'))
    hash.update(chunk)
    yield chunk
  }
  const actual = hash.digest('hex')
  if (size !== expected.size || actual !== expected.hash) throw new LocalizedError(msg('localEdit.changedAgain'))
  yield commitRecord(actual)
}

/** Opens a regular copy and verifies the path still points to that file.
 * @param path App-managed path.
 * @returns Open file handle owned by the caller.
 */
async function openLocalEdit(path: string): Promise<FileHandle> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile()) throw new LocalizedError(msg('localEdit.invalidCopy'))
  const file = await open(path, 'r')
  try {
    const actual = await file.stat({ bigint: true })
    if (actual.isFile() && actual.dev === before.dev && actual.ino === before.ino) return file
    throw new LocalizedError(msg('localEdit.invalidCopy'))
  } catch (error) {
    await file.close()
    throw error
  }
}

/** Creates a verified local snapshot and returns the remote version it represents.
 * @param commands Remote file session scope.
 * @param source Absolute remote path.
 * @param destination Unoccupied local file path.
 * @returns The downloaded content hash and remote stat fingerprint.
 */
export async function downloadLocalEdit(commands: RemoteCommandTarget, source: string, destination: string): Promise<TextFileVersion> {
  const guard = regularFileGuard('$1')
  const fingerprint = 'stat -c "%d:%i:%s:%y:%z" -- "$1"'
  const { stdout } = await runRemoteCommand(commands, `set -eu\n${guard}\n${fingerprint}`, [source], { maxStdoutBytes: 1024 })
  const identity = stdout.toString().trimEnd()
  const size = Number(identity.split(':')[2])
  if (!Number.isSafeInteger(size) || size < 0) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersion'))
  const hash = createHash('sha256')
  const file = await open(destination, 'wx')
  let received = 0
  try {
    await runRemoteCommand(commands, `set -eu
${guard}
[[ $(${fingerprint}) == "$2" ]]
head -c "$3" -- "$1"
${guard}
[[ $(${fingerprint}) == "$2" ]]`, [source, identity, String(size)], {
      timeoutMs: 86_400_000, maxStdoutBytes: size, collectStdout: false,
      onStdout: async chunk => {
        received += chunk.length
        hash.update(chunk)
        await writeAll(file, chunk)
      },
    })
    if (received !== size) throw new LocalizedError(msg('errors.serverFileChangedDuringDownload'))
    await file.sync()
    return parseFileVersion(hash.digest('hex'), identity)
  } finally {
    await file.close()
  }
}

/** Exports the verified revision without replacing existing files.
 * @param source App-managed copy.
 * @param directory User-selected export directory.
 * @param name Original file name.
 * @param expectedHash SHA-256 of the revision selected for export.
 * @returns Absolute path of the exported copy.
 */
export async function exportLocalEdit(source: string, directory: string, name: string, expectedHash: string): Promise<string> {
  const reserved = new Set<string>()
  while (true) {
    const candidate = await uniqueDownloadName(directory, name, reserved)
    const destination = join(directory, candidate)
    let file: FileHandle
    try {
      file = await open(destination, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      reserved.add(candidate.toLowerCase())
      continue
    }
    try {
      try {
        const version = await readLocalEdit(source, chunk => writeAll(file, chunk))
        if (version.hash !== expectedHash) throw new LocalizedError(msg('localEdit.changedAgain'))
        await file.sync()
      } finally {
        await file.close()
      }
      return destination
    } catch (error) {
      await unlink(destination)
      throw error
    }
  }
}
