import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { Client } from 'ssh2'
import type { ScriptExecutionEvent, ScriptExecutionRequest } from '../shared/types.ts'
import { executeRemoteCommand, RemoteCommandError, RemoteTerminationError } from './ssh-commands'
import { shellQuote } from '../shared/shell.ts'

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
  private readonly tasks = new Map<string, { request: ScriptExecutionRequest; controller: AbortController; fail?: string }>()
  constructor(private readonly getSession: SessionLookup, private readonly sendEvent: EventSink) {}
  start(value: unknown): void {
    const request = parseScriptExecutionRequest(value)
    if (this.tasks.has(request.requestId)) throw new Error('脚本执行请求编号已在使用')
    const session = this.getSession(request.sessionId)
    if (!session || session.kind !== 'files') throw new Error('文件会话未连接')
    const task = { request, controller: new AbortController(), fail: undefined as string | undefined }
    this.tasks.set(request.requestId, task)
    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
    let retainedBytes = 0
    const output = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      retainedBytes += chunk.length
      if (retainedBytes > 8 * 1024 * 1024) throw new Error('脚本输出达到 8 MiB 上限，已停止读取；远端状态未知')
      const data = decoders[stream].write(chunk)
      if (data) this.sendEvent({ type: 'output', requestId: request.requestId, sessionId: request.sessionId, stream, data })
    }
    void executeRemoteCommand(session.client, buildScriptExecutionCommand(request.scriptPath, request.command), {
      signal: task.controller.signal, collectStdout: false, keepStdinOpen: true, timeoutMs: 86_400_000,
      onStdout: chunk => output('stdout', chunk), onStderr: chunk => output('stderr', chunk),
      onComplete: error => {
        this.tasks.delete(request.requestId)
        for (const stream of ['stdout', 'stderr'] as const) {
          const data = decoders[stream].end()
          if (data) this.sendEvent({ type: 'output', requestId: request.requestId, sessionId: request.sessionId, stream, data })
        }
        const common = { requestId: request.requestId, sessionId: request.sessionId }
        if (task.fail) this.sendEvent({ type: 'failed', ...common, message: task.fail })
        else if (error instanceof RemoteTerminationError && error.reason === 'cancelled') this.sendEvent({ type: 'cancelled', ...common, message: error.message })
        else if (error) this.sendEvent({ type: 'failed', ...common, exitCode: error instanceof RemoteCommandError ? error.exitCode : null, message: error.message })
        else this.sendEvent({ type: 'completed', ...common, exitCode: 0 })
      },
    }).catch(() => undefined)
  }
  cancel(requestId: string): boolean {
    const task = this.tasks.get(requestId)
    if (!task || task.controller.signal.aborted) return false
    task.controller.abort()
    return true
  }
  cancelForSession(sessionId: string): void {
    for (const task of this.tasks.values()) if (task.request.sessionId === sessionId) this.cancel(task.request.requestId)
  }
  failForSession(sessionId: string, message: string): void {
    for (const task of this.tasks.values()) if (task.request.sessionId === sessionId) { task.fail = 'SSH 连接中断：' + message; task.controller.abort() }
  }
}
