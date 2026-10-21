import { posix } from 'node:path'
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2'

export interface SftpAttributes {
  mode?: number
  size?: number
  mtime?: number
}

export interface SftpDirectoryEntry {
  filename: string
  attrs: SftpAttributes
}

export function fileType(mode?: number): 'directory' | 'file' | 'symlink' | 'other' {
  const kind = (mode ?? 0) & 0o170000
  if (kind === 0o040000) return 'directory'
  if (kind === 0o100000) return 'file'
  if (kind === 0o120000) return 'symlink'
  return 'other'
}

export function sftpLstat(sftp: SFTPWrapper, remotePath: string): Promise<SftpAttributes> {
  return new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error, attrs) => error ? reject(error) : resolve(attrs))
  })
}

export function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<SftpDirectoryEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, entries) => error ? reject(error) : resolve(entries))
  })
}

export function isRemoteNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string | number }).code
  return code === 2 || code === 'ENOENT' || /no such file|not found/i.test(error.message)
}

export async function remoteAttributesOrNull(sftp: SFTPWrapper, remotePath: string): Promise<SftpAttributes | null> {
  try {
    return await sftpLstat(sftp, remotePath)
  } catch (error) {
    if (isRemoteNotFound(error)) return null
    throw error
  }
}

export function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => error ? reject(error) : resolve())
  })
}

export function sftpRename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (error) => error ? reject(error) : resolve())
  })
}

export function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => error ? reject(error) : resolve())
  })
}

export function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (error) => error ? reject(error) : resolve())
  })
}

export function normalizedRemotePath(remotePath: string): string {
  if (typeof remotePath !== 'string' || !remotePath || remotePath.includes('\0')) {
    throw new Error('远程路径无效')
  }
  return posix.resolve('/', remotePath)
}

export function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function executeRemoteCommand(client: Client, command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | null = null
    let exitCode: number | null = null
    let settled = false
    const stderr: Buffer[] = []
    const cleanup = () => {
      client.removeListener('error', onClientError)
      client.removeListener('end', onClientEnd)
      client.removeListener('close', onClientClose)
      stream?.stderr.removeListener('data', onStderrData)
      stream?.stderr.removeListener('error', onStreamError)
      stream?.removeListener('error', onStreamError)
      stream?.removeListener('exit', onExit)
      stream?.removeListener('close', onStreamClose)
    }
    const finish = (reason?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (reason) reject(reason)
      else resolve()
    }
    const onClientError = (clientError: Error) => finish(new Error('SSH 连接失败：' + clientError.message))
    const onClientEnd = () => finish(new Error('SSH 连接已结束'))
    const onClientClose = () => finish(new Error('SSH 连接已关闭'))
    const onStderrData = (chunk: Buffer) => stderr.push(Buffer.from(chunk))
    const onStreamError = (streamError: Error) => finish(streamError)
    const onExit = (code: number | null) => {
      exitCode = typeof code === 'number' ? code : null
      if (exitCode === 0) {
        finish()
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      finish(new Error(detail || '远程命令失败（退出码 ' + (exitCode ?? '未知') + '）'))
    }
    const onStreamClose = () => {
      if (exitCode === 0) {
        finish()
        return
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim()
      finish(new Error(detail || '远程命令失败（退出码 ' + (exitCode ?? '未知') + '）'))
    }

    client.on('error', onClientError)
    client.once('end', onClientEnd)
    client.once('close', onClientClose)
    try {
      client.exec(command, (error, commandStream) => {
        if (error) {
          finish(error)
          return
        }
        stream = commandStream
        if (settled) {
          stream.destroy()
          return
        }
        stream.stderr.on('data', onStderrData)
        stream.stderr.once('error', onStreamError)
        stream.once('error', onStreamError)
        stream.once('exit', onExit)
        stream.once('close', onStreamClose)
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
