import { LocalizedError, type MessageValue } from '../shared/i18n/messages.ts'
import { runRemoteCommand, type RemoteCommandOptions, type RemoteCommandTarget } from './ssh-commands.ts'

export const rangeReadOptions = 'bs=256K iflag=skip_bytes,count_bytes'

interface ByteRead {
  offset?: number
  length: number
  error: MessageValue
  signal?: AbortSignal
  timeoutMs?: number
  onChunk?: (chunk: Buffer) => void | Promise<void>
}

/**
 * Reads exactly the requested bytes. An omitted offset selects prefix reading for downloads.
 * @param target Active SSH command scope and identity.
 * @param path File read on the server.
 * @param read Length, optional offset, lifecycle and streaming options.
 * @returns The exact bytes for buffered reads, or an empty buffer for streaming reads.
 */
export async function readRemoteBytes(target: RemoteCommandTarget, path: string, read: ByteRead): Promise<Buffer> {
  const { offset, length, signal, timeoutMs, onChunk } = read
  if (!Number.isSafeInteger(length) || length < 0 || (offset !== undefined
    && (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(offset + length)))) {
    throw new RangeError('Invalid remote byte range')
  }
  signal?.throwIfAborted()
  let received = 0
  const options: RemoteCommandOptions = { signal, timeoutMs, maxStdoutBytes: length, collectStdout: !onChunk,
    onStdout: onChunk && (chunk => { received += chunk.length; return onChunk(chunk) }) }
  const result = offset === undefined
    ? await runRemoteCommand(target, 'exec head -c "$2" -- "$1"', [path, String(length)], options)
    : await runRemoteCommand(target, `exec dd if="$1" ${rangeReadOptions} skip="$2" count="$3" status=none`,
      [path, String(offset), String(length)], options)
  if ((onChunk ? received : result.stdout.length) !== length) throw new LocalizedError(read.error)
  return result.stdout
}
