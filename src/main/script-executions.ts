import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Client, ClientChannel } from 'ssh2'
import type { ScriptExecutionEvent, ScriptExecutionRequest } from '../shared/types.ts'
import { shellQuote } from '../shared/shell.ts'

interface ScriptExecutionTask {
  request: ScriptExecutionRequest
  client: Client
  stream: ClientChannel | null
  finished: boolean
  exitCode: number | null
  stdoutDecoder: StringDecoder
  stderrDecoder: StringDecoder
  clientError: (error: Error) => void
  clientEnd: () => void
  clientClose: () => void
  stdoutData: (chunk: Buffer) => void
  stderrData: (chunk: Buffer) => void
  streamError: (error: Error) => void
  exit: (code: number | null) => void
  close: () => void
}

interface ScriptExecutionSession {
  client: Client
  kind: 'files' | 'terminal'
}

type SessionLookup = (sessionId: string) => ScriptExecutionSession | undefined
type EventSink = (event: ScriptExecutionEvent) => void

function normalizedScriptPath(scriptPath: string): string {
  if (typeof scriptPath !== 'string' || !scriptPath || scriptPath.includes('\0')) throw new Error('远程路径无效')
  return posix.resolve('/', scriptPath)
}

export function buildScriptExecutionCommand(scriptPath: string, command: string): string {
  const normalizedPath = normalizedScriptPath(scriptPath)
  if (normalizedPath === '/') throw new Error('脚本路径无效')
  return `cd -- ${shellQuote(posix.dirname(normalizedPath))} && exec sh -c ${shellQuote(command)}`
}

export function parseScriptExecutionRequest(value: unknown): ScriptExecutionRequest {
  if (!value || typeof value !== 'object') throw new Error('脚本执行请求无效')
  const request = value as Partial<ScriptExecutionRequest>
  if (typeof request.requestId !== 'string' || !request.requestId || request.requestId.length > 128
    || typeof request.sessionId !== 'string' || !request.sessionId
    || typeof request.scriptPath !== 'string' || !request.scriptPath
    || typeof request.command !== 'string' || !request.command.trim() || request.command.length > 65535
    || request.command.includes('\0')) {
    throw new Error('脚本执行参数无效')
  }
  const scriptPath = normalizedScriptPath(request.scriptPath)
  if (scriptPath === '/') throw new Error('脚本路径无效')
  return { requestId: request.requestId, sessionId: request.sessionId, scriptPath, command: request.command }
}

export class ScriptExecutionManager {
  private readonly tasks = new Map<string, ScriptExecutionTask>()
  private readonly getSession: SessionLookup
  private readonly sendEvent: EventSink

  constructor(
    getSession: SessionLookup,
    sendEvent: EventSink,
  ) {
    this.getSession = getSession
    this.sendEvent = sendEvent
  }

  start(value: unknown): void {
    const request = parseScriptExecutionRequest(value)
    if (this.tasks.has(request.requestId)) throw new Error('脚本执行请求编号已在使用')
    const session = this.getSession(request.sessionId)
    if (!session || session.kind !== 'files') throw new Error('文件会话未连接')

    const task: ScriptExecutionTask = {
      request,
      client: session.client,
      stream: null,
      finished: false,
      exitCode: null,
      stdoutDecoder: new StringDecoder('utf8'),
      stderrDecoder: new StringDecoder('utf8'),
      clientError: () => undefined,
      clientEnd: () => undefined,
      clientClose: () => undefined,
      stdoutData: () => undefined,
      stderrData: () => undefined,
      streamError: () => undefined,
      exit: () => undefined,
      close: () => undefined,
    }
    task.clientError = (error) => this.finish(task, {
      type: 'failed', requestId: request.requestId, sessionId: request.sessionId, message: 'SSH 连接失败：' + error.message,
    }, true)
    task.clientEnd = () => this.finish(task, {
      type: 'failed', requestId: request.requestId, sessionId: request.sessionId, message: 'SSH 连接已结束，脚本执行中断',
    }, true)
    task.clientClose = () => this.finish(task, {
      type: 'failed', requestId: request.requestId, sessionId: request.sessionId, message: 'SSH 连接已关闭，脚本执行中断',
    }, true)
    task.stdoutData = (chunk) => this.sendOutput(task, 'stdout', task.stdoutDecoder.write(chunk))
    task.stderrData = (chunk) => this.sendOutput(task, 'stderr', task.stderrDecoder.write(chunk))
    task.streamError = (error) => this.finish(task, {
      type: 'failed', requestId: request.requestId, sessionId: request.sessionId, message: '脚本执行通道失败：' + error.message,
    }, true)
    task.exit = (code) => { task.exitCode = typeof code === 'number' ? code : null }
    task.close = () => {
      if (task.exitCode === 0) {
        this.finish(task, { type: 'completed', requestId: request.requestId, sessionId: request.sessionId, exitCode: 0 })
      } else {
        const exitCode = task.exitCode
        this.finish(task, {
          type: 'failed',
          requestId: request.requestId,
          sessionId: request.sessionId,
          exitCode,
          message: exitCode === null ? '脚本执行通道关闭时未收到退出码' : '脚本执行失败，退出码 ' + exitCode,
        })
      }
    }

    this.tasks.set(request.requestId, task)
    session.client.on('error', task.clientError)
    session.client.on('end', task.clientEnd)
    session.client.on('close', task.clientClose)
    try {
      session.client.exec(buildScriptExecutionCommand(request.scriptPath, request.command), (error, stream) => {
        if (error) {
          this.finish(task, {
            type: 'failed', requestId: request.requestId, sessionId: request.sessionId, message: '无法启动脚本：' + error.message,
          })
          return
        }
        task.stream = stream
        if (task.finished) {
          this.terminate(stream)
          return
        }
        stream.on('data', task.stdoutData)
        stream.stderr.on('data', task.stderrData)
        stream.once('error', task.streamError)
        stream.stderr.once('error', task.streamError)
        stream.once('exit', task.exit)
        stream.once('close', task.close)
      })
    } catch (error) {
      this.finish(task, {
        type: 'failed',
        requestId: request.requestId,
        sessionId: request.sessionId,
        message: '无法启动脚本：' + (error instanceof Error ? error.message : String(error)),
      })
    }
  }

  cancel(requestId: string): boolean {
    const task = this.tasks.get(requestId)
    if (!task) return false
    this.finish(task, { type: 'cancelled', requestId: task.request.requestId, sessionId: task.request.sessionId }, true)
    return true
  }

  cancelForSession(sessionId: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.request.sessionId === sessionId) this.cancel(task.request.requestId)
    }
  }

  failForSession(sessionId: string, message: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.request.sessionId !== sessionId) continue
      this.finish(task, {
        type: 'failed',
        requestId: task.request.requestId,
        sessionId,
        message: 'SSH 连接中断：' + message,
      }, true)
    }
  }

  private sendOutput(task: ScriptExecutionTask, stream: 'stdout' | 'stderr', data: string): void {
    if (data) {
      this.sendEvent({ type: 'output', requestId: task.request.requestId, sessionId: task.request.sessionId, stream, data })
    }
  }

  private finish(task: ScriptExecutionTask, event: Exclude<ScriptExecutionEvent, { type: 'output' }>, terminate = false): void {
    if (task.finished) return
    task.finished = true
    this.tasks.delete(task.request.requestId)
    const stream = task.stream
    task.client.removeListener('error', task.clientError)
    task.client.removeListener('end', task.clientEnd)
    task.client.removeListener('close', task.clientClose)
    stream?.removeListener('data', task.stdoutData)
    stream?.stderr.removeListener('data', task.stderrData)
    stream?.stderr.removeListener('error', task.streamError)
    stream?.removeListener('error', task.streamError)
    stream?.removeListener('exit', task.exit)
    stream?.removeListener('close', task.close)
    this.sendOutput(task, 'stdout', task.stdoutDecoder.end())
    this.sendOutput(task, 'stderr', task.stderrDecoder.end())
    this.sendEvent(event)
    if (terminate && stream) this.terminate(stream)
  }

  private terminate(stream: ClientChannel): void {
    try {
      stream.signal('TERM')
    } catch {
      // The peer may already have closed the channel.
    }
    try {
      stream.close()
    } catch {
      // The peer may already have closed the channel.
    }
  }
}

