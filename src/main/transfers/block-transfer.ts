import { open as openLocalFile, type FileHandle } from 'node:fs/promises'
import type { SFTPWrapper } from 'ssh2'

export const TRANSFER_CHUNK_SIZE = 32 * 1024
export const MAX_TRANSFER_REQUESTS = 64

type Direction = 'upload' | 'download'

function openRemoteFile(sftp: SFTPWrapper, remotePath: string, mode: 'r' | 'w'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.open(remotePath, mode, (error, handle) => error ? reject(error) : resolve(handle))
  })
}

async function readRemoteBlock(sftp: SFTPWrapper, handle: Buffer, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const bytesRead = await new Promise<number>((resolve, reject) => {
      sftp.read(handle, buffer, offset, length - offset, position + offset, (error, count) => {
        if (error) reject(error)
        else resolve(count)
      })
    })
    if (bytesRead === 0) throw new Error('服务器文件在传输期间发生变化')
    offset += bytesRead
  }
  return buffer
}

function writeRemoteBlock(sftp: SFTPWrapper, handle: Buffer, buffer: Buffer, position: number): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.write(handle, buffer, 0, buffer.length, position, (error) => error ? reject(error) : resolve())
  })
}

function closeRemoteFile(sftp: SFTPWrapper, handle: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.close(handle, (error) => error ? reject(error) : resolve())
  })
}

async function readLocalBlock(file: FileHandle, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset)
    if (bytesRead === 0) throw new Error('本机文件在传输期间发生变化')
    offset += bytesRead
  }
  return buffer
}

async function writeLocalBlock(file: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset, position + offset)
    if (bytesWritten === 0) throw new Error('无法继续写入本机文件')
    offset += bytesWritten
  }
}

export async function transferFileBlocks(
  direction: Direction,
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationPath: string,
  size: number,
  requestConcurrency: number,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
): Promise<void> {
  let localFile: FileHandle | undefined
  let remoteHandle: Buffer | undefined
  let transferError: unknown
  let hasTransferError = false

  try {
    if (direction === 'upload') {
      localFile = await openLocalFile(sourcePath, 'r')
      signal.throwIfAborted()
      remoteHandle = await openRemoteFile(sftp, destinationPath, 'w')
    } else {
      remoteHandle = await openRemoteFile(sftp, sourcePath, 'r')
      signal.throwIfAborted()
      localFile = await openLocalFile(destinationPath, 'w')
    }
    signal.throwIfAborted()

    let nextOffset = 0
    let firstError: unknown
    let hasFirstError = false
    const blockCount = Math.ceil(size / TRANSFER_CHUNK_SIZE)
    const workerCount = Math.min(blockCount, requestConcurrency)
    const workers = Array.from({ length: workerCount }, async () => {
      while (!hasFirstError && !signal.aborted) {
        const position = nextOffset
        nextOffset += TRANSFER_CHUNK_SIZE
        if (position >= size) return
        const length = Math.min(TRANSFER_CHUNK_SIZE, size - position)
        try {
          if (direction === 'upload') {
            const block = await readLocalBlock(localFile!, position, length)
            if (signal.aborted || hasFirstError) return
            await writeRemoteBlock(sftp, remoteHandle!, block, position)
          } else {
            const block = await readRemoteBlock(sftp, remoteHandle!, position, length)
            if (signal.aborted || hasFirstError) return
            await writeLocalBlock(localFile!, block, position)
          }
          onProgress(length)
        } catch (error) {
          if (!signal.aborted && !hasFirstError) {
            firstError = error
            hasFirstError = true
          }
          return
        }
      }
    })
    await Promise.all(workers)
    if (signal.aborted) signal.throwIfAborted()
    if (hasFirstError) throw firstError
  } catch (error) {
    transferError = error
    hasTransferError = true
  }

  const closeErrors: unknown[] = []
  if (remoteHandle) {
    try {
      await closeRemoteFile(sftp, remoteHandle)
    } catch (error) {
      closeErrors.push(error)
    }
  }
  if (localFile) {
    try {
      await localFile.close()
    } catch (error) {
      closeErrors.push(error)
    }
  }

  if (hasTransferError) throw transferError
  if (signal.aborted) signal.throwIfAborted()
  if (closeErrors.length) throw closeErrors[0]
}
