import { randomUUID } from 'node:crypto'
import { tool } from 'ai'
import { z } from 'zod'
import { LocalizedError, msg, renderMessage } from '../shared/i18n/messages'
import type { AssistantApproval, AssistantOutput, AssistantQuestion, AssistantToolRecord, AssistantTurn } from '../shared/types/assistant'
import type { RemoteCommandExecutor } from './ssh-commands'
import { AssistantProcess } from './assistant-process'
import { assistantPath } from './assistant-prompt'

export type AssistantInteraction = (request: AssistantApproval | AssistantQuestion, signal: AbortSignal) => Promise<string | boolean>

const executionId = z.uuid()
const stdinText = z.string().min(1).max(4096).nullable()
const stdinInput = z.strictObject({
  executionId: executionId.describe('The executionId returned by exec_command for a command that is still running.'),
  text: stdinText.describe('Exact ordinary input to send, including any needed newline, or JSON null to close stdin.'),
})

/**
 * Explains a rejected write_stdin input without returning model-supplied values or unexpected key names.
 * @param raw JSON arguments rejected by the tool input validator.
 * @returns A localized explanation of the failed contract.
 */
export function describeStdinInputFailure(raw: string): string {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return renderMessage(msg('assistant.stdinInputObject'))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return renderMessage(msg('assistant.stdinInputObject'))
  if (stdinInput.safeParse(value).success) return renderMessage(msg('assistant.toolInputInvalid'))
  const fields = value as Record<string, unknown>
  const issues: string[] = []
  if (!executionId.safeParse(fields.executionId).success) issues.push(renderMessage(msg('assistant.stdinExecutionId')))
  if (!stdinText.safeParse(fields.text).success) issues.push(renderMessage(msg('assistant.stdinText')))
  if (Object.keys(fields).some((name) => name !== 'executionId' && name !== 'text')) {
    issues.push(renderMessage(msg('assistant.stdinInputFields')))
  }
  return [renderMessage(msg('assistant.toolInputInvalid')), ...issues].join(' ')
}

/** Builds the command and interaction tools for one turn and its SSH execution scope. */
export function assistantCommandTools(context: {
  commands: RemoteCommandExecutor; signal: AbortSignal; turn: AssistantTurn; update: () => void;
  checkpoint: () => void;
  save: (id: string, page: number, output: AssistantOutput[]) => void;
  read: (id: string, page: number) => AssistantOutput[]; interact: AssistantInteraction;
}) {
  const { commands, signal, turn, update, checkpoint, save, read, interact } = context
  const processes = new Map<string, AssistantProcess>()

  /** Resolves an execution that belongs to this turn. */
  function get(executionId: string): AssistantProcess {
    const process = processes.get(executionId)
    if (!process) throw new LocalizedError(msg('assistant.processEnded'))
    return process
  }

  /** Returns one output page and cursor together with the current command status. */
  function result(process: AssistantProcess, cursor: number) {
    const { id, status, exitCode, outputPages = 0, truncated = false, error } = process.record
    if (cursor > outputPages) throw new LocalizedError(msg('assistant.invalid'))
    return { executionId: id, status, exitCode, error, truncated, output: cursor < outputPages ? read(id, cursor) : [],
      cursor: Math.min(cursor + 1, outputPages), more: cursor + 1 < outputPages }
  }

  /** Requests approval for the exact operation when this turn uses manual mode. */
  async function approve(request: AssistantApproval, interactionSignal = signal): Promise<boolean> {
    return turn.mode === 'automatic' || await interact(request, interactionSignal) === true
  }

  /** Wraps expected command and input failures for the model without exposing raw transport errors. */
  async function execute<T>(action: () => Promise<T>): Promise<T | { error: string }> {
    try {
      signal.throwIfAborted()
      return await action()
    } catch (error) {
      signal.throwIfAborted()
      if (error instanceof LocalizedError) return { error: renderMessage(error.localizedMessage) }
      throw error
    }
  }

  const cursor = z.int().min(0).max(2_000_000)
  const tools = {
    exec_command: tool({
      description: 'Run a Shell script on the connected server. Defaults to the task directory. Use a PTY only when a terminal is needed. Returns an execution ID, status, and the first output page.',
      inputSchema: z.strictObject({ command: z.string().min(1).max(32000).refine((value) => !value.includes('\0')),
        purpose: z.string().trim().min(1).max(500), directory: assistantPath.optional(), pty: z.boolean().optional() }),
      execute: (input) => execute(async () => {
        if (turn.tools.length >= 1000) throw new LocalizedError(msg('assistant.limit'))
        const id = randomUUID()
        const record: AssistantToolRecord = { id, name: 'exec_command', path: input.directory ?? turn.directory,
          status: 'pending', command: input.command, purpose: input.purpose, pty: input.pty ?? false }
        const process = new AssistantProcess(record, commands, signal, (page, output) => save(id, page, output), update)
        processes.set(id, process)
        turn.tools.push(record)
        turn.activity.push({ kind: 'tool', id })
        if (!await approve({ id: randomUUID(), executionId: id, kind: 'command' })) {
          record.status = 'rejected'
          update()
          return result(process, 0)
        }
        process.start(checkpoint)
        await process.wait(300)
        return result(process, 0)
      }),
    }),
    wait_process: tool({
      description: 'Read the next output page from this execution using its cursor. While running, waits briefly for output or completion.',
      inputSchema: z.strictObject({ executionId, cursor, waitMs: z.int().min(0).max(120000).optional() }),
      execute: (input) => execute(async () => {
        const process = get(input.executionId)
        if (input.cursor >= (process.record.outputPages ?? 0)) await process.wait(input.waitMs ?? 30000)
        return result(process, input.cursor)
      }),
    }),
    write_stdin: tool({
      description: 'Write ordinary input to a running command. Supply executionId and text. Set text to JSON null to close stdin (EOF). This tool cannot poll output; use wait_process for that. Use ask_user for passwords.',
      inputSchema: stdinInput,
      execute: (input) => execute(async () => {
        const process = get(input.executionId)
        process.checkInput()
        const request = { id: randomUUID(), executionId: input.executionId }
        if (!await approve(input.text === null ? { ...request, kind: 'eof' } : { ...request, kind: 'input', text: input.text }, process.lifetime)) {
          return { status: 'rejected' }
        }
        if (input.text === null) await process.endInput()
        else await process.write(input.text)
        return { status: 'sent' }
      }),
    }),
    stop_process: tool({
      description: 'Stop a running managed command and report whether its termination was confirmed.',
      inputSchema: z.strictObject({ executionId }),
      execute: (input) => execute(async () => {
        const process = get(input.executionId)
        if (process.record.status === 'pending') throw new LocalizedError(msg('assistant.processEnded'))
        await process.stop()
        return { status: process.record.status, exitCode: process.record.exitCode }
      }),
    }),
    ask_user: tool({
      description: 'Ask the user for information. Include a running execution ID only when asking the user to send a password directly to that process. The password is never returned to the model.',
      inputSchema: z.strictObject({ question: z.string().trim().min(1).max(1000), executionId: executionId.optional() }),
      execute: (input) => execute(async () => {
        const process = input.executionId ? get(input.executionId) : undefined
        process?.checkInput()
        const answer = await interact({ id: randomUUID(), text: input.question, executionId: input.executionId }, process?.lifetime ?? signal)
        if (!process) return { answer }
        await process.write(String(answer), true)
        return { status: 'sent' }
      }),
    }),
  }

  return {
    tools,
    /** Stops all commands owned by this turn and marks any unlaunched command as stopped. */
    async close() {
      for (const { record } of processes.values()) if (record.status === 'pending') record.status = 'stopped'
      await Promise.all([...processes.values()].map((process) => process.stop()))
    },
  }
}
