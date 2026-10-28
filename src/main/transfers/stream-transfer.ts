import { createReadStream } from 'node:fs'
import { open, rename, stat as localStat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Client } from 'ssh2'
import type { OperationExecutionStrategy } from '@shared/types'
import { runRemoteCommand } from '../ssh-commands'
import { uploadMoveFlag } from './upload-strategy'

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
    if (!uploadOptions) throw new Error('上传预检信息缺失')
    const source = createReadStream(sourcePath, { highWaterMark: TRANSFER_CHUNK_SIZE })
    let uploaded = 0
    const chunks = async function* () {
      for await (const value of source) {
        const chunk = Buffer.from(value)
        uploaded += chunk.length
        if (uploaded > size) throw new Error('本机文件在上传期间发生变化')
        yield chunk
      }
      const attributes = await localStat(sourcePath)
      if (uploaded !== size || attributes.size !== size || attributes.mtimeMs !== uploadOptions.modifiedAtMs) {
        throw new Error('本机文件在上传期间发生变化')
      }
    }
    const moveFlag = uploadMoveFlag(uploadOptions.strategy)
    try {
      await runRemoteCommand(client, [
        'set -eu',
        'destination=$1',
        'directory=$(dirname -- "$destination")',
        'name=$(basename -- "$destination")',
        'temporary=$(mktemp -- "$directory/.$name.linux-nexus.XXXXXX")',
        'trap \'rm -f -- "$temporary"\' EXIT',
        'trap \'exit 129\' HUP',
        'trap \'exit 130\' INT',
        'trap \'exit 143\' TERM',
        'cat > "$temporary"',
        'touch -d "@$2" -- "$temporary"',
        `mv ${moveFlag} -- "$temporary" "$destination"`,
        '[[ ! -e "$temporary" ]] || rm -f -- "$temporary"',
        'trap - EXIT HUP INT TERM',
      ].join('\n'), [destinationPath, String(uploadOptions.modifiedAtMs / 1000)], {
        signal,
        stdin: chunks(),
        collectStdout: false,
        onStdin: (chunk) => onProgress(chunk.length),
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
        signal,
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
    await rename(temporaryPath, destinationPath)
    completed = true
  } finally {
    if (fileOpen) await file.close()
    if (!completed) await unlink(temporaryPath).catch(() => undefined)
  }
}
