import { assistantId, modelId, limitsSchema, assistantPromptSchema } from '../shared/assistant-settings'
import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { z } from 'zod'
import { modelMessageSchema } from 'ai'
import { LocalizedError, msg } from '../shared/i18n/messages'
import type { AssistantConversation, AssistantLimits, AssistantMode, AssistantOutput, AssistantProvider } from '../shared/types/assistant'
import { atomicWriteJson } from './json-store'

export const assistantDefaults: AssistantLimits = { steps: 100, modelTimeoutSeconds: 120 }
const providerSchema = z.strictObject({
  id: assistantId, name: z.string().min(1).max(100), baseUrl: z.string().max(2048),
  models: z.array(modelId).min(1).max(500), defaultModel: modelId, ciphertext: z.string().nullable(),
})
const settingsSchema = z.strictObject({ version: z.literal(1), providers: z.array(providerSchema).max(30), limits: limitsSchema })
export type StoredProvider = z.infer<typeof providerSchema>
type AssistantSettings = z.infer<typeof settingsSchema>

const toolSchema = z.strictObject({
  id: z.string(), name: z.string(), path: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'unknown', 'rejected', 'stopped']),
  output: z.string().optional(), error: z.string().optional(), elapsedMs: z.number().optional(), command: z.string().optional(),
  exitCode: z.number().nullable().optional(), purpose: z.string().optional(), pty: z.boolean().optional(),
  outputPages: z.int().nonnegative().optional(), truncated: z.boolean().optional(),
}).refine(({ command, id }) => command === undefined || assistantId.safeParse(id).success)
export const assistantModeSchema = z.enum(['manual', 'automatic'])
const approvalBase = { id: assistantId, executionId: assistantId }
const conversationSchema = z.strictObject({
  id: assistantId, title: z.string().optional(), updatedAt: z.int().nonnegative().max(8_640_000_000_000_000), turns: z.array(z.strictObject({
    id: assistantId, prompt: z.string(), directory: z.string(), providerId: assistantId, model: modelId, text: z.string(), mode: assistantModeSchema,
    activity: z.array(z.union([z.strictObject({ kind: z.literal('text'), text: z.string() }),
      z.strictObject({ kind: z.enum(['tool', 'supplement']), id: z.string() })])),
    tools: z.array(toolSchema), transcript: z.array(modelMessageSchema),
    supplements: z.array(z.strictObject({ id: assistantId, text: z.string(), status: z.enum(['queued', 'delivered', 'undelivered']) })),
    status: z.enum(['running', 'done', 'stopped', 'failed', 'interrupted', 'limit']), error: z.string().optional(),
    approvals: z.array(z.discriminatedUnion('kind', [
      z.strictObject({ ...approvalBase, kind: z.literal('command') }),
      z.strictObject({ ...approvalBase, kind: z.literal('input'), text: z.string() }),
      z.strictObject({ ...approvalBase, kind: z.literal('eof') }),
    ])),
    questions: z.array(z.strictObject({ id: assistantId, text: z.string(), executionId: assistantId.optional() })),
  })),
})
const encryptedSchema = z.strictObject({ ciphertext: z.string().min(1) })
const modeSchema = z.strictObject({ mode: assistantModeSchema })
const promptSchema = z.strictObject({ prompt: assistantPromptSchema })
const outputSchema = z.array(z.strictObject({ stream: z.enum(['stdout', 'stderr']), text: z.string() }))

/** Resolves a file name within the assistant's application data directory. */
function storagePath(name: string): string {
  if (!directory) throw new LocalizedError(msg('assistant.storage'))
  return join(directory, name)
}

let directory: string | undefined

/** Selects the existing application data directory for settings and history. */
export function configureAssistantStorage(dataDirectory: string): void {
  directory = dataDirectory
  const trash = storagePath(join('assistant-history', 'trash'))
  try {
    for (const item of historyEntries(trash)) {
      if (item.isDirectory() && /^[a-f0-9-]{73}$/i.test(item.name)) cleanDeletedConversation(join(trash, item.name))
    }
  } catch (error) {
    reportStorageFailure('cleanup', trash, error)
  }
}

/** Encrypts plaintext with the OS credential store, or fails without writing it. */
export function encryptAssistantData(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new LocalizedError(msg('assistant.encryption'))
  return safeStorage.encryptString(plaintext).toString('base64')
}

/** Decrypts a stored ciphertext without including its contents in errors. */
export function decryptAssistantData(ciphertext: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new LocalizedError(msg('assistant.encryption'))
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  } catch {
    throw new LocalizedError(msg('assistant.storage'))
  }
}

/** Reads versioned settings, supplying defaults on first use. */
export function readAssistantSettings(): AssistantSettings {
  const path = storagePath('assistant-settings.json')
  const contents = readStorageFile(path, true)
  return contents === undefined ? { version: 1, providers: [], limits: { ...assistantDefaults } } : decodeStorage(path, contents, settingsSchema)
}

/** Validates and atomically saves settings, including encrypted credentials. */
export function saveAssistantSettings(settings: AssistantSettings): void {
  const path = storagePath('assistant-settings.json')
  writeStorageFile(path, decodeStorage(path, JSON.stringify(settings), settingsSchema))
}

/** Returns the provider fields safe to expose to the application UI. */
export function publicAssistantProvider({ ciphertext, ...provider }: StoredProvider): AssistantProvider {
  return { ...provider, hasKey: ciphertext !== null }
}

/** Loads the execution mode for a verified server key and effective identity. */
export function readAssistantMode(serverKey: string, identity: string): AssistantMode {
  const path = storagePath('assistant-mode-' + serverKey + '-' + identity + '.json')
  const contents = readStorageFile(path, true)
  return contents === undefined ? 'manual' : decodeStorage(path, contents, modeSchema).mode
}

/** Stores the mode selected for the verified server key and effective identity. */
export function saveAssistantMode(serverKey: string, identity: string, mode: AssistantMode): void {
  writeStorageFile(storagePath('assistant-mode-' + serverKey + '-' + identity + '.json'), { mode })
}

type StorageStage = 'read' | 'decrypt' | 'format' | 'write' | 'cleanup'

/** Records a storage failure at stage for path without logging file contents or exception messages. */
function reportStorageFailure(stage: StorageStage, path: string, error: unknown): LocalizedError {
  const cause = error instanceof Error && error.cause ? error.cause : error
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined
  // Error messages from validators and encryption may quote private input.
  const category = error instanceof Error ? error.name : undefined
  console.error('Assistant storage failure', { stage, file: basename(dirname(path)) + '/' + basename(path), category, code })
  return new LocalizedError(msg(stage === 'cleanup' ? 'assistant.storageCleanup' :
    stage === 'read' ? 'assistant.storageRead' : stage === 'decrypt' ? 'assistant.storageDecrypt' :
    stage === 'format' ? 'assistant.storageFormat' : 'assistant.storageWrite'))
}

/** Reads path as UTF-8; optional files may be absent but other read errors are reported. */
function readStorageFile(path: string, optional: true): string | undefined
function readStorageFile(path: string, optional?: false): string
function readStorageFile(path: string, optional = false): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw reportStorageFailure('read', path, error)
  }
}

/** Parses contents at path using schema, returning validated application data. */
function decodeStorage<T>(path: string, contents: string, schema: z.ZodType<T>): T {
  try {
    return schema.parse(JSON.parse(contents))
  } catch (error) {
    throw reportStorageFailure('format', path, error)
  }
}

/** Atomically replaces the JSON file at path with value, creating its parent directory on demand. */
function writeStorageFile(path: string, value: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
    atomicWriteJson(path, value)
  } catch (error) {
    throw reportStorageFailure('write', path, error)
  }
}

/** Decrypts the supplied envelope at path and validates the decoded value using schema. */
function decryptStorage<T>(path: string, contents: string, schema: z.ZodType<T>): T {
  const { ciphertext } = decodeStorage(path, contents, encryptedSchema)
  let plaintext: string
  try {
    plaintext = decryptAssistantData(ciphertext)
  } catch (error) {
    throw reportStorageFailure('decrypt', path, error)
  }
  return decodeStorage(path, plaintext, schema)
}

/** Serializes and validates value with schema before atomically replacing the encrypted file at path. */
function saveEncrypted<T>(path: string, value: T, schema: z.ZodType<T>): void {
  let plaintext: string
  try {
    plaintext = JSON.stringify(value)
  } catch (error) {
    throw reportStorageFailure('format', path, error)
  }
  decodeStorage(path, plaintext, schema)
  let ciphertext: string
  try {
    ciphertext = encryptAssistantData(plaintext)
  } catch (error) {
    throw reportStorageFailure('write', path, error)
  }
  writeStorageFile(path, { ciphertext })
}

/** Reads the prompt override for a scope key, or null to inherit. */
export function readAssistantPrompt(scope: string): string | null {
  const path = storagePath('assistant-prompt-' + scope + '.json')
  const contents = readStorageFile(path, true)
  return contents === undefined ? null : decryptStorage(path, contents, promptSchema).prompt
}

/** Stores a complete prompt override or clears it with null. */
export function saveAssistantPrompt(scope: string, prompt: string | null): void {
  saveEncrypted(storagePath('assistant-prompt-' + scope + '.json'), { prompt }, promptSchema)
}

/** Returns entries at path, treating a missing directory as a fresh store. */
function historyEntries(path: string) {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw reportStorageFailure('read', path, error)
  }
}

/** Resolves the history folder for a verified server key and optional conversation UUID. */
function historyPath(serverKey: string, conversationId?: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(serverKey) || (conversationId && !assistantId.safeParse(conversationId).success)) {
    throw new LocalizedError(msg('assistant.invalid'))
  }
  return storagePath(join('assistant-history', 'servers', serverKey, conversationId ?? ''))
}

/** Loads each saved conversation for serverKey and reports unreadable records independently. */
export function readAssistantHistory(serverKey: string): {
  conversations: AssistantConversation[]; issues: string[]; cleanupWarning?: string
} {
  const conversations: AssistantConversation[] = []
  const issues: string[] = []
  const path = historyPath(serverKey)
  for (const entry of historyEntries(path)) {
    if (!entry.isDirectory() || !assistantId.safeParse(entry.name).success) continue
    const file = join(path, entry.name, 'conversation.json')
    try {
      // A first write interrupted before the atomic rename has no committed conversation.
      const contents = readStorageFile(file, true)
      if (contents === undefined && historyEntries(join(path, entry.name)).every((item) => item.name.endsWith('.tmp'))) continue
      const chat = decryptStorage(file, contents ?? readStorageFile(file), conversationSchema)
      if (chat.id !== entry.name) throw reportStorageFailure('format', file, undefined)
      conversations.push(chat)
    } catch (error) {
      if (!(error instanceof LocalizedError)) throw error
      issues.push(error.message)
    }
  }
  return { conversations, issues: [...new Set(issues)] }
}

/** Atomically saves the given conversation for serverKey without touching its neighbors. */
export function saveAssistantConversation(serverKey: string, conversation: AssistantConversation): void {
  saveEncrypted(join(historyPath(serverKey, conversation.id), 'conversation.json'), conversation, conversationSchema)
}

/** Returns the output page path for a managed execution within its owning conversation. */
function outputPath(serverKey: string, conversationId: string, executionId: string, page: number): string {
  if (!assistantId.safeParse(executionId).success || !Number.isSafeInteger(page) || page < 0) {
    throw new LocalizedError(msg('assistant.invalid'))
  }
  return join(historyPath(serverKey, conversationId), 'output', executionId, page + '.json')
}

/** Saves output for the given server, conversation, execution and zero-based page. */
export function saveAssistantOutput(serverKey: string, conversationId: string, executionId: string, page: number, output: AssistantOutput[]): void {
  saveEncrypted(outputPath(serverKey, conversationId, executionId, page), output, outputSchema)
}

/** Reads the zero-based output page for the specified server, conversation and execution. */
export function readAssistantOutput(serverKey: string, conversationId: string, executionId: string, page: number): AssistantOutput[] {
  const path = outputPath(serverKey, conversationId, executionId, page)
  return decryptStorage(path, readStorageFile(path), outputSchema)
}

/** Counts fully written pages at and after first for the specified server, conversation and execution. */
export function recoverAssistantOutput(serverKey: string, conversationId: string, executionId: string, first: number): number {
  let pages = first
  while (existsSync(outputPath(serverKey, conversationId, executionId, pages))) pages++
  return pages
}

/** Removes a previously committed deletion at path, returning a warning if cleanup needs a retry. */
function cleanDeletedConversation(path: string): string | undefined {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch (error) {
    return reportStorageFailure('cleanup', path, error).message
  }
}

/** Moves the conversation under trash and returns a cleanup warning if its files could not be removed. */
export function removeAssistantConversation(serverKey: string, conversationId: string): string | undefined {
  const path = historyPath(serverKey, conversationId)
  const trash = storagePath(join('assistant-history', 'trash'))
  const destination = join(trash, conversationId + '-' + randomUUID())
  try {
    mkdirSync(trash, { recursive: true })
    renameSync(path, destination)
  } catch (error) {
    throw reportStorageFailure('write', path, error)
  }
  return cleanDeletedConversation(destination)
}
