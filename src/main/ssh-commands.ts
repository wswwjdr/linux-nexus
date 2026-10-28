import type { Client, ClientChannel } from 'ssh2'
import { shellQuote } from '../shared/shell.ts'

const TERMINATION_GRACE_MS = 2_000

export interface RemoteCommandOptions {
  signal?: AbortSignal
  stdin?: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
  onStdin?: (chunk: Buffer) => void
  onStdout?: (chunk: Buffer) => void | Promise<void>
  collectStdout?: boolean
  maxStdoutBytes?: number
  timeoutMs?: number
}

export interface RemoteCommandResult {
  stdout: Buffer
  stderr: string
  exitCode: number | null
}

export function buildRemoteCommand(script: string, args: readonly string[] = []): string {
  return `bash -c ${shellQuote(script)} --${args.length ? ' ' + args.map(shellQuote).join(' ') : ''}`
}

export function executeRemoteCommand(
  client: Client,
  command: string,
  options: RemoteCommandOptions = {},
): Promise<RemoteCommandResult> {
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | null = null
    let exitCode: number | null = null
    let settled = false
    let abortedBeforeOpen = false
    let terminationReason: 'cancelled' | 'timeout' | null = null
    let terminationSignalSent = false
    let streamingOutput = false
    let outputBytes = 0
    let pendingOutput: Promise<void> = Promise.resolve()
    let timeout: NodeJS.Timeout | undefined
    let terminationTimer: NodeJS.Timeout | undefined
    let onAbort = () => {}
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const cleanup = () => {
      if (timeout) clearTimeout(timeout)
      if (terminationTimer) clearTimeout(terminationTimer)
      options.signal?.removeEventListener('abort', onAbort)
      client.removeListener('error', onClientError)
      client.removeListener('end', onClientEnd)
      client.removeListener('close', onClientClose)
      stream?.removeListener('data', onStdoutData)
      stream?.stderr.removeListener('data', onStderrData)
      stream?.removeListener('error', onStreamError)
      stream?.stderr.removeListener('error', onStreamError)
      stream?.removeListener('exit', onExit)
      stream?.removeListener('close', onClose)
    }
    const terminationError = () => new Error(
      terminationReason === 'timeout' ? '远程命令执行超时' : '远程命令已取消',
    )
    const requestTermination = (reason: 'cancelled' | 'timeout') => {
      terminationReason ??= reason
      abortedBeforeOpen = true
      if (!stream) return
      if (!terminationSignalSent) {
        terminationSignalSent = true
        try { stream.signal('TERM') } catch { /* channel may already be closed */ }
      }
      if (terminationTimer) return
      terminationTimer = setTimeout(() => {
        if (settled) return
        stream?.close()
        finish(terminationError())
      }, TERMINATION_GRACE_MS)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      const result = {
        stdout: options.collectStdout === false ? Buffer.alloc(0) : Buffer.concat(stdout, outputBytes),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
      }
      if (exitCode !== 0) {
        reject(new Error(result.stderr || `远程命令失败（退出码 ${exitCode ?? '未知'}）`))
        return
      }
      resolve(result)
    }
    const onClientError = (error: Error) => finish(new Error('SSH 连接失败：' + error.message))
    const onClientEnd = () => finish(new Error('SSH 连接已结束'))
    const onClientClose = () => finish(new Error('SSH 连接已关闭'))
    const onStdoutData = (chunk: Buffer) => {
      const buffer = Buffer.from(chunk)
      outputBytes += buffer.length
      if (options.maxStdoutBytes !== undefined && outputBytes > options.maxStdoutBytes) {
        stream?.close()
        finish(new Error('服务器命令输出超过允许大小'))
        return
      }
      if (options.collectStdout !== false) stdout.push(buffer)
      if (options.onStdout) {
        stream?.pause()
        streamingOutput = true
        try {
          pendingOutput = Promise.resolve(options.onStdout(buffer))
        } catch (error) {
          stream?.close()
          finish(error instanceof Error ? error : new Error(String(error)))
          return
        }
        void pendingOutput.then(() => {
          if (!settled && streamingOutput) {
            streamingOutput = false
            stream?.resume()
          }
        }, (error: unknown) => {
          stream?.close()
          finish(error instanceof Error ? error : new Error(String(error)))
        })
      }
    }
    const onStderrData = (chunk: Buffer) => stderr.push(Buffer.from(chunk))
    const onStreamError = (error: Error) => finish(error)
    const onExit = (code: number | null) => { exitCode = typeof code === 'number' ? code : null }
    const onClose = (code: number | null) => {
      void pendingOutput.then(() => {
        if (terminationReason) {
          finish(terminationError())
          return
        }
        if (exitCode === null && typeof code === 'number') exitCode = code
        finish()
      }, (error: unknown) => finish(error instanceof Error ? error : new Error(String(error))))
    }

    onAbort = () => {
      requestTermination('cancelled')
    }
    if (options.signal?.aborted) {
      reject(new Error('远程命令已取消'))
      return
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => requestTermination('timeout'), options.timeoutMs)
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
        stream.on('data', onStdoutData)
        stream.stderr.on('data', onStderrData)
        stream.once('error', onStreamError)
        stream.stderr.once('error', onStreamError)
        stream.once('exit', onExit)
        stream.once('close', onClose)
        if (terminationReason) {
          requestTermination(terminationReason)
          return
        }
        if (abortedBeforeOpen) {
          onAbort()
          return
        }
        if (options.stdin) {
          void (async () => {
            try {
              for await (const chunk of options.stdin!) {
                if (settled || options.signal?.aborted) break
                const buffer = Buffer.from(chunk)
                if (!stream!.write(buffer)) {
                  await new Promise<void>((ready, failed) => {
                    const channel = stream!
                    const cleanupDrain = () => {
                      channel.removeListener('drain', onDrain)
                      channel.removeListener('close', onChannelClose)
                      channel.removeListener('error', onChannelError)
                      options.signal?.removeEventListener('abort', onSignalAbort)
                    }
                    const onDrain = () => { cleanupDrain(); ready() }
                    const onChannelClose = () => { cleanupDrain(); failed(new Error('SSH 命令通道已关闭')) }
                    const onChannelError = (error: Error) => { cleanupDrain(); failed(error) }
                    const onSignalAbort = () => { cleanupDrain(); failed(new Error('远程命令已取消')) }
                    channel.once('drain', onDrain)
                    channel.once('close', onChannelClose)
                    channel.once('error', onChannelError)
                    options.signal?.addEventListener('abort', onSignalAbort, { once: true })
                    if (settled || channel.destroyed || options.signal?.aborted) onSignalAbort()
                  })
                }
                options.onStdin?.(buffer)
              }
              if (!settled) stream!.end()
            } catch (stdinError) {
              if (terminationReason || options.signal?.aborted) {
                requestTermination('cancelled')
                return
              }
              try { stream?.signal('TERM') } catch { /* channel may already be closed */ }
              stream?.close()
              finish(stdinError instanceof Error ? stdinError : new Error(String(stdinError)))
            }
          })()
        } else {
          stream.end()
        }
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function runRemoteCommand(
  client: Client,
  script: string,
  args: readonly string[] = [],
  options: RemoteCommandOptions = {},
): Promise<RemoteCommandResult> {
  return executeRemoteCommand(client, buildRemoteCommand(script, args), options)
}
