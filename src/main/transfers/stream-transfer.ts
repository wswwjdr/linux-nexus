import { createReadStream } from 'node:fs'
import { open, link, stat as localStat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { commitRecord } from '../staged-write'
import { createHash, randomUUID } from 'node:crypto'
import type { Client } from 'ssh2'
import type { OperationExecutionStrategy } from '@shared/types'
import { runRemoteCommand } from '../ssh-commands'
import { buildUploadCommand } from './upload-command'

export const TRANSFER_CHUNK_SIZE = 256 * 1024

type Direction = 'upload' | 'download'

interface UploadOptions {
  strategy: OperationExecutionStrategy
  modifiedAtMs: number
}

async function writeAll(file: Awaited<ReturnType<typeof open>>, chunk: Buffer): Promise<void> {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset)
    if (bytesWritten === 0) throw new Error('无法继续写入本机临时文件')
    offset += bytesWritten
  }
}

export async function transferFileStream(
  direction: Direction,
  client: Client,
  sourcePath: string,
  destinationPath: string,
  size: number,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
  uploadOptions?: UploadOptions,
): Promise<void> {
  signal.throwIfAborted()
  if (direction === 'upload') {
    if (!uploadOptions) throw new Error('上传参数缺失')
    const source = createReadStream(sourcePath, { highWaterMark: TRANSFER_CHUNK_SIZE })
    let uploaded = 0
    let reported = 0
    const hash = createHash('sha256')
    const chunks = async function* () {
      for await (const value of source) {
        const chunk = Buffer.from(value)
        uploaded += chunk.length
        hash.update(chunk)
        if (uploaded > size) throw new Error('本机文件在上传期间发生变化')
        yield chunk
      }
      const attributes = await localStat(sourcePath)
      if (uploaded !== size || attributes.size !== size || attributes.mtimeMs !== uploadOptions.modifiedAtMs) {
        throw new Error('本机文件在上传期间发生变化')
      }
      signal.throwIfAborted()
      yield commitRecord(hash.digest('hex'))
    }
    try {
      await runRemoteCommand(client, buildUploadCommand(uploadOptions.strategy),
        [destinationPath, String(uploadOptions.modifiedAtMs / 1000), String(size)], {
        signal, timeoutMs: 86_400_000,
        stdin: chunks(),
        collectStdout: false,
        onStdin: (chunk) => { const bytes = Math.min(chunk.length, size - reported); reported += bytes; onProgress(bytes) },
      })
    } finally {
      source.destroy()
    }
    return
  }

  const temporaryPath = join(dirname(destinationPath), '.' + basename(destinationPath) + '.linux-nexus-' + randomUUID() + '.tmp')
  const file = await open(temporaryPath, 'wx')
  let completed = false
  let fileOpen = true
  let received = 0
  try {
    await runRemoteCommand(client,
      'dd if="$1" iflag=skip_bytes,count_bytes skip=0 count="$2" status=none',
      [sourcePath, String(size)],
      {
        signal, timeoutMs: 86_400_000,
        collectStdout: false,
        onStdout: async (chunk) => {
          received += chunk.length
          await writeAll(file, chunk)
          onProgress(chunk.length)
        },
      },
    )
    if (received !== size) throw new Error('服务器文件在下载期间发生变化')
    await file.sync()
    await file.close()
    fileOpen = false
    const original = basename(destinationPath)
    const dot = original.lastIndexOf('.')
    const stem = dot > 0 ? original.slice(0, dot) : original
    const extension = dot > 0 ? original.slice(dot) : ''
    for (let index = 0; ; index += 1) {
      signal.throwIfAborted()
      const candidate = index === 0 ? destinationPath : join(dirname(destinationPath), `${stem} (${index})${extension}`)
      try {
        // A hard link publishes the complete file without replacing any existing name.
        // Unsupported filesystems fail explicitly; there is no clobbering fallback.
        await link(temporaryPath, candidate)
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    await unlink(temporaryPath)
    completed = true
  } finally {
    if (fileOpen) await file.close()
    if (!completed) await unlink(temporaryPath).catch(() => undefined)
  }
}
