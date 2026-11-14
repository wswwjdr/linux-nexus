import { PassThrough } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import type { AssistantOutput, AssistantToolRecord } from '../shared/types/assistant'
import { LocalizedError, msg, renderMessage } from '../shared/i18n/messages'
import { buildRemoteCommand, RemoteCommandError, RemoteTerminationError, SudoAuthenticationError, type RemoteCommandExecutor } from './ssh-commands'

const pageSize = 8192
const outputLimit = 16 * 1024 * 1024
const previewSize = 4096

class CommandOutput {
  private readonly decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }
  private readonly pending = { stdout: '', stderr: '' }
  private readonly secrets = new Set<string>()
  private total = 0
  private page: AssistantOutput[] = []
  private size = 0

  /** Stores bounded pages via save and publishes an updated live tail via changed. */
  constructor(private record: AssistantToolRecord,
    private save: (page: number, output: AssistantOutput[]) => void, private changed: () => void) {}

  /** Registers an exact value to redact from subsequent output on both streams. */
  protect(value: string): void {
    this.secrets.add(value)
  }

  /** Decodes a chunk from a specific stream, retaining partial characters and secret prefixes. */
  append(stream: AssistantOutput['stream'], chunk: Buffer): void {
    this.consume(stream, this.decoders[stream].write(chunk), false)
  }

  /** Flushes the remaining decoded output and releases secret references. */
  finish(): void {
    try {
      for (const stream of ['stdout', 'stderr'] as const) this.consume(stream, this.decoders[stream].end(), true)
      this.checkpoint()
    } finally {
      this.secrets.clear()
      this.pending.stdout = this.pending.stderr = ''
    }
  }

  /** Persists a partial page so its cursor can be used by the model and renderer. */
  checkpoint(): void {
    if (!this.page.length) return
    const index = this.record.outputPages ?? 0
    this.save(index, this.page)
    this.record.outputPages = index + 1
    this.page = []
    this.size = 0
  }

  /** Removes exact protected values and keeps a suffix that might complete in the next chunk. */
  private consume(stream: AssistantOutput['stream'], chunk: string, final: boolean): void {
    const text = this.pending[stream] + chunk
    const secrets = [...this.secrets].sort((a, b) => b.length - a.length)
    let offset = 0
    let output = ''
    while (offset < text.length) {
      const next = secrets.reduce((first, secret) => {
        const index = text.indexOf(secret, offset)
        return index >= 0 && (first === -1 || index < first) ? index : first
      }, -1)
      if (next === -1) break
      const secret = secrets.find((value) => text.startsWith(value, next))!
      output += text.slice(offset, next) + '[redacted]'
      offset = next + secret.length
    }
    const remaining = text.slice(offset)
    let retain = final ? 0 : Math.min(remaining.length, Math.max(0, ...secrets.map((value) => value.length - 1)))
    while (retain && !secrets.some((secret) => secret.startsWith(remaining.slice(-retain)))) retain--
    this.pending[stream] = retain ? remaining.slice(-retain) : ''
    output += remaining.slice(0, remaining.length - retain)
    if (output) this.store(stream, output)
  }

  /** Adds sanitized text to the bounded log and live preview. */
  private store(stream: AssistantOutput['stream'], text: string): void {
    const available = outputLimit - this.total
    if (text.length > available) {
      this.record.truncated = true
      this.total = outputLimit
    } else {
      this.total += text.length
    }
    const splitPair = text.length > available && /[\uD800-\uDBFF]/.test(text[available - 1])
    text = text.slice(0, splitPair ? available - 1 : available)
    this.record.output = ((this.record.output ?? '') + text).slice(-previewSize)
    while (text.length) {
      let length = Math.min(pageSize - this.size, text.length)
      // Keep UTF-16 pairs together when splitting a decoded chunk between pages.
      if (/[\uD800-\uDBFF]/.test(text[length - 1]) && length < text.length) length--
      if (length) {
        const part = text.slice(0, length)
        const last = this.page.at(-1)
        if (last?.stream === stream) last.text += part
        else this.page.push({ stream, text: part })
        this.size += length
        text = text.slice(length)
      }
      if (!length || this.size === pageSize) this.checkpoint()
    }
    this.changed()
  }
}

export class AssistantProcess {
  private readonly controller = new AbortController()
  private readonly input = new PassThrough({ highWaterMark: 4096 })
  private readonly output: CommandOutput
  readonly lifetime: AbortSignal
  private completion?: Promise<void>
  private writing = false
  private inputEnded = false
  private inputAcknowledgement?: (accepted: boolean) => void
  private readonly outputWaiters = new Set<() => void>()

  /** Owns one command record and its bounded output, using the supplied SSH connection scope. */
  constructor(readonly record: AssistantToolRecord, private commands: RemoteCommandExecutor,
    private signal: AbortSignal, save: (page: number, output: AssistantOutput[]) => void, private changed: () => void) {
    this.output = new CommandOutput(record, save, () => {
      for (const wake of this.outputWaiters) wake()
      changed()
    })
    this.lifetime = AbortSignal.any([signal, this.controller.signal])
  }

  /** Persists the launch record through checkpoint, then starts the approved script on its own SSH channel. */
  start(checkpoint: () => void): void {
    this.signal.throwIfAborted()
    this.record.status = 'running'
    try {
      checkpoint()
    } catch (error) {
      this.record.status = 'failed'
      this.record.error = renderMessage(error instanceof LocalizedError ? error.localizedMessage : msg('assistant.storageWrite'))
      this.changed()
      throw error
    }
    this.changed()
    this.completion = this.execute()
  }

  /** Waits up to milliseconds for output or completion, then saves any partial page. */
  async wait(milliseconds: number): Promise<void> {
    if (this.record.status === 'running') await this.waitForOutput(milliseconds)
    this.output.checkpoint()
  }

  /** Resolves after a stream update, process completion, or the specified wait. */
  private async waitForOutput(milliseconds: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let wake!: () => void
    try {
      await Promise.race([this.completion, new Promise<void>((resolve) => {
        wake = resolve
        this.outputWaiters.add(wake)
        timer = setTimeout(wake, milliseconds)
      })])
    } finally {
      clearTimeout(timer)
      this.outputWaiters.delete(wake)
    }
  }

  /** Sends input to this running command, optionally marking the exact text as secret. */
  async write(text: string, secret = false): Promise<void> {
    this.checkInput()
    if (this.writing) throw new LocalizedError(msg('assistant.inputBusy'))
    if (secret) this.output.protect(text)
    this.writing = true
    try {
      const accepted = await new Promise<boolean>((resolve) => {
        this.inputAcknowledgement = resolve
        this.input.write(secret ? text + '\n' : text, (error) => { if (error) resolve(false) })
      })
      if (!accepted) throw new LocalizedError(msg('assistant.processEnded'))
    } finally {
      this.writing = false
      this.inputAcknowledgement = undefined
    }
  }

  /** Closes the running command's input stream. PTY programs receive their terminal EOF key. */
  async endInput(): Promise<void> {
    this.checkInput()
    if (this.writing) throw new LocalizedError(msg('assistant.inputBusy'))
    if (this.record.pty) await this.write('\x04')
    else this.input.end()
    this.inputEnded = true
  }

  /** Requests SSH termination and waits for the transport to report the outcome. */
  async stop(): Promise<void> {
    this.controller.abort()
    await this.completion
  }

  /** Checks whether this specific execution still accepts input. */
  checkInput(): void {
    this.signal.throwIfAborted()
    if (this.record.status !== 'running' || this.inputEnded || this.input.destroyed || this.controller.signal.aborted) {
      throw new LocalizedError(msg('assistant.processEnded'))
    }
  }

  /** Executes one channel, drains streams, and records confirmed and uncertain outcomes. */
  private async execute(): Promise<void> {
    const start = Date.now()
    const signal = this.lifetime
    try {
      // Keep the exec group created by sshd, so its signal requests reach the script and its children.
      const script = buildRemoteCommand('cd -- "$1" && exec bash -c "$2"', [this.record.path, this.record.command!])
      const result = await this.commands.execute('exec ' + script, {
          signal, timeoutMs: null, stdin: this.input, collectStdout: false, maxStderrBytes: 0, managedTermination: true,
          pty: this.record.pty ? { term: 'dumb', modes: { ECHO: 0, ONLCR: 0 } } : undefined,
          onStdout: (chunk) => this.output.append('stdout', chunk),
          onStderr: (chunk) => this.output.append('stderr', chunk),
          onStdin: () => this.inputAcknowledgement?.(true),
          onComplete: (_error, result) => { this.record.exitCode = result?.exitCode ?? null },
        })
      this.record.exitCode = result.exitCode
      this.record.status = 'done'
    } catch (error) {
      if (error instanceof RemoteCommandError && error.exitCode !== null) {
        this.record.exitCode = error.exitCode
        this.record.status = 'failed'
      } else if (error instanceof SudoAuthenticationError) {
        this.record.status = 'failed'
        this.record.error = renderMessage(msg('assistant.executionIdentityFailed'))
      } else if (error instanceof RemoteTerminationError && error.remoteState === 'exited') {
        this.record.status = 'stopped'
      } else {
        this.record.status = 'unknown'
        this.record.error = renderMessage(msg('assistant.unknownState'))
      }
    } finally {
      this.inputAcknowledgement?.(false)
      this.input.destroy()
      this.controller.abort(new LocalizedError(msg('assistant.processEnded')))
      this.record.elapsedMs = Date.now() - start
      try {
        this.output.finish()
      } catch (error) {
        this.record.truncated = true
        this.record.error = renderMessage(error instanceof LocalizedError ? error.localizedMessage : msg('assistant.storageWrite'))
      }
      this.changed()
    }
  }
}
