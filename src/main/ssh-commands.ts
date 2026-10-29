import type { Client, ClientChannel } from 'ssh2'
import { shellQuote } from '../shared/shell.ts'

interface ClientTasks {
  controllers: Set<AbortController>
  failures: Set<(error: Error) => void>
  idle: Set<() => void>
  onError: (error: Error) => void
  onEnd: () => void
  onClose: () => void
}
const tasks = new WeakMap<Client, ClientTasks>()
export function cancelClientTasks(client: Client): Promise<void> {
  const owner = tasks.get(client)
  if (!owner) return Promise.resolve()
  const idle = new Promise<void>(resolve => owner.idle.add(resolve))
  for (const controller of [...owner.controllers]) controller.abort()
  return idle
}
function ownTask(client: Client, controller: AbortController, fail: (error: Error) => void): () => void {
  let owned = tasks.get(client)
  if (!owned) {
    const failures = new Set<(error: Error) => void>()
    const notify = (error: Error) => { for (const failure of [...failures]) failure(error) }
    owned = {
      controllers: new Set(), failures, idle: new Set(),
      onError: error => notify(new Error('SSH 连接失败：' + error.message)),
      onEnd: () => notify(new Error('SSH 连接已结束；远端状态未知')),
      onClose: () => notify(new Error('SSH 连接已关闭；远端状态未知')),
    }
    tasks.set(client, owned)
    client.on('error', owned.onError)
    client.on('end', owned.onEnd)
    client.on('close', owned.onClose)
  }
  const owner = owned
  owner.controllers.add(controller)
  owner.failures.add(fail)
  return () => {
    owner.controllers.delete(controller)
    owner.failures.delete(fail)
    if (owner.controllers.size === 0) {
      client.removeListener('error', owner.onError)
      client.removeListener('end', owner.onEnd)
      client.removeListener('close', owner.onClose)
      tasks.delete(client)
      for (const idle of owner.idle) idle()
    }
  }
}
export interface RemoteCommandOptions {
  signal?: AbortSignal
  stdin?: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
  onStdin?: (chunk: Buffer) => void
  onStdout?: (chunk: Buffer) => void | Promise<void>
  onStderr?: (chunk: Buffer) => void
  onComplete?: (error: Error | undefined, result?: RemoteCommandResult) => void
  collectStdout?: boolean
  maxStdoutBytes?: number
  maxStderrBytes?: number
  timeoutMs?: number
  keepStdinOpen?: boolean
}
export interface RemoteCommandResult { stdout: Buffer; stderr: string; exitCode: number | null }
export class RemoteCommandError extends Error {
  constructor(readonly exitCode: number | null, readonly stderr: string) {
    super(stderr || (exitCode === null ? 'SSH 连接中断，未收到命令退出码；远端状态未知' : `远程命令失败（退出码 ${exitCode}）`))
  }
}
export class RemoteTerminationError extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout', readonly remoteState: 'exited' | 'unknown') {
    super((reason === 'timeout' ? '远程命令执行超时' : '远程命令已取消') + (remoteState === 'unknown' ? '；远端状态未知，可能仍在运行' : '；命令通道已结束，子进程状态未确认'))
    this.name = reason === 'cancelled' ? 'AbortError' : 'TimeoutError'
  }
}
export function buildRemoteCommand(script: string, args: readonly string[] = []): string {
  return `bash -c ${shellQuote(script)} --${args.length ? ' ' + args.map(shellQuote).join(' ') : ''}`
}
export function executeRemoteCommand(client: Client, command: string, options: RemoteCommandOptions = {}): Promise<RemoteCommandResult> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let releaseOwner = () => {}
    const abortParent = () => controller.abort()
    options.signal?.addEventListener('abort', abortParent, { once: true })
    let stream: ClientChannel | null = null
    let settled = false
    let reason: 'cancelled' | 'timeout' | null = null
    let exitCode: number | null = null
    let outputBytes = 0, errorBytes = 0
    let truncated = false
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let pending: Promise<void> | null = null
    let cancelInputWait: (() => void) | undefined
    let timer: NodeJS.Timeout | undefined, grace: NodeJS.Timeout | undefined
    const asError = (value: unknown) => value instanceof Error ? value : new Error(String(value))
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cancelInputWait?.()
      clearTimeout(timer); clearTimeout(grace)
      releaseOwner()
      options.signal?.removeEventListener('abort', abortParent)
      controller.signal.removeEventListener('abort', cancel)
      stream?.removeListener('data', onData); stream?.stderr.removeListener('data', onStderr)
      stream?.removeListener('error', onError); stream?.stderr.removeListener('error', onError)
      stream?.removeListener('exit', onExit); stream?.removeListener('close', onClose)
      const result = { stdout: options.collectStdout === false ? Buffer.alloc(0) : Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString('utf8') + (truncated ? '\n[stderr 已截断]' : ''), exitCode }
      error ??= exitCode === 0 ? undefined : new RemoteCommandError(exitCode, result.stderr)
      options.onComplete?.(error, result)
      if (error) reject(error); else resolve(result)
    }
    const stop = (why: 'cancelled' | 'timeout') => {
      reason ??= why
      if (!stream) { finish(new RemoteTerminationError(reason, 'unknown')); return }
      if (grace) return
      // Arm before sending: peers and test transports may acknowledge synchronously.
      grace = setTimeout(() => { stream?.close(); finish(new RemoteTerminationError(reason!, 'unknown')) }, 2000)
      try { stream.signal('TERM') } catch { /* The peer may already have closed. */ }
    }
    const cancel = () => stop('cancelled')
    const onError = (error: Error) => {
      if (settled) return
      finish(error)
      try { stream?.signal('TERM') } catch { /* The peer may already have closed. */ }
      stream?.close()
    }
    const onData = (chunk: Buffer) => {
      const bytes = Buffer.from(chunk)
      outputBytes += bytes.length
      if (outputBytes > (options.maxStdoutBytes ?? (options.collectStdout === false ? Infinity : 64 * 1024 * 1024))) {
        onError(new Error('服务器命令输出超过允许大小；远端状态未知')); return
      }
      if (options.collectStdout !== false) stdout.push(bytes)
      try {
        const output = options.onStdout?.(bytes)
        if (output) {
          stream!.pause()
          pending = (pending ?? Promise.resolve()).then(() => output)
          void pending.then(() => { if (!settled) stream!.resume() }, error => onError(asError(error)))
        }
      } catch (error) { onError(asError(error)) }
    }
    const onStderr = (chunk: Buffer) => {
      try { options.onStderr?.(chunk) } catch (error) { onError(asError(error)); return }
      const remaining = (options.maxStderrBytes ?? 256 * 1024) - errorBytes
      if (chunk.length > remaining) truncated = true
      if (remaining > 0) { const bytes = Buffer.from(chunk.subarray(0, remaining)); stderr.push(bytes); errorBytes += bytes.length }
    }
    const onExit = (code: number | null) => { exitCode = typeof code === 'number' ? code : null }
    const onClose = (code: number | null) => {
      const complete = () => {
        if (exitCode === null && typeof code === 'number') exitCode = code
        finish(reason ? new RemoteTerminationError(reason, exitCode === null ? 'unknown' : 'exited') : undefined)
      }
      if (pending) void pending.then(complete, error => finish(asError(error))); else complete()
    }
    releaseOwner = ownTask(client, controller, finish)
    controller.signal.addEventListener('abort', cancel, { once: true })
    if (options.signal?.aborted) { cancel(); return }
    timer = setTimeout(() => stop('timeout'), options.timeoutMs ?? 30_000)
    try {
      client.exec(command, (error, channel) => {
        if (error) { finish(error); return }
        stream = channel
        if (settled) { try { channel.signal('TERM') } catch {} channel.destroy(); return }
        channel.on('data', onData); channel.stderr.on('data', onStderr)
        channel.once('error', onError); channel.stderr.once('error', onError)
        channel.once('exit', onExit); channel.once('close', onClose)
        if (options.stdin) void (async () => {
          try {
            for await (const value of options.stdin!) {
              if (settled || controller.signal.aborted) return
              const bytes = Buffer.from(value)
              if (!channel.write(bytes)) await new Promise<void>((ready, failed) => {
                const cleanup = () => { cancelInputWait = undefined; channel.removeListener('drain', drain); channel.removeListener('close', closed); channel.removeListener('error', failedStream); controller.signal.removeEventListener('abort', aborted) }
                const drain = () => { cleanup(); ready() }
                const closed = () => { cleanup(); failed(new Error('SSH 命令通道已关闭')) }
                const failedStream = (error: Error) => { cleanup(); failed(error) }
                const aborted = () => { cleanup(); failed(new RemoteTerminationError('cancelled', 'unknown')) }
                cancelInputWait = aborted
                channel.once('drain', drain); channel.once('close', closed); channel.once('error', failedStream); controller.signal.addEventListener('abort', aborted, { once: true })
                if (settled || controller.signal.aborted) aborted()
              })
              options.onStdin?.(bytes)
            }
            if (!settled) channel.end()
          } catch (error) { onError(asError(error)) }
        })()
        else if (!options.keepStdinOpen) channel.end()
      })
    } catch (error) { finish(asError(error)) }
  })
}
export function runRemoteCommand(client: Client, script: string, args: readonly string[] = [], options: RemoteCommandOptions = {}): Promise<RemoteCommandResult> {
  return executeRemoteCommand(client, buildRemoteCommand(script, args), options)
}
