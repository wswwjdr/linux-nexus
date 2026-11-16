import type { FileIdentity } from './sessions'
import type { ModelMessage } from 'ai'

export interface AssistantProviderInput {
  id?: string
  name: string
  baseUrl: string
  apiKey?: string | null
  models: string[]
  defaultModel: string
}

export interface AssistantProvider extends Omit<AssistantProviderInput, 'id' | 'apiKey'> {
  id: string
  hasKey: boolean
}

export interface AssistantLimits {
  steps: number
  modelTimeoutSeconds: number
}

export type AssistantProbeResult = Partial<Record<'authentication' | 'chat' | 'stream' | 'tools', 'ok' | 'failed' | 'unverified'>>
  & { detail?: string }

export type AssistantActivity = { kind: 'text'; text: string } | { kind: 'tool' | 'supplement'; id: string }

export type AssistantMode = 'manual' | 'automatic'
export type AssistantOutput = { stream: 'stdout' | 'stderr'; text: string }
export type AssistantPromptSettings = { defaultPrompt: string; globalPrompt: string | null; serverPrompt: string | null }
export type AssistantApproval = { id: string; executionId: string } &
  ({ kind: 'command' } | { kind: 'input'; text: string } | { kind: 'eof' })
export type AssistantQuestion = { id: string; text: string; executionId?: string }
export type AssistantRunning = { sessionId: string; conversationId: string; taskId: string }

export interface AssistantToolRecord {
  id: string
  name: string
  path: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'unknown' | 'rejected' | 'stopped'
  output?: string
  error?: string
  elapsedMs?: number
  command?: string
  exitCode?: number | null
  purpose?: string
  pty?: boolean
  outputPages?: number
  truncated?: boolean
}

export interface AssistantTurn {
  id: string
  prompt: string
  directory: string
  providerId: string
  model: string
  mode: AssistantMode
  text: string
  activity: AssistantActivity[]
  tools: AssistantToolRecord[]
  supplements: Array<{ id: string; text: string; status: 'queued' | 'delivered' | 'undelivered' }>
  transcript: ModelMessage[]
  status: 'running' | 'done' | 'stopped' | 'failed' | 'interrupted' | 'limit'
  error?: string
  approvals: AssistantApproval[]
  questions: AssistantQuestion[]
}

export interface AssistantConversation {
  id: string
  title?: string
  updatedAt: number
  turns: AssistantTurn[]
}

export interface AssistantSnapshot {
  sessionId: string
  serverKey: string
  identity: FileIdentity
  mode: AssistantMode
  conversations: AssistantConversation[]
  historyIssues: string[]
  cleanupWarning?: string
  running: AssistantRunning[]
  sequence: number
}

export type AssistantEventChange = { serverKey: string; conversationId: string } & (
  | { kind: 'turn'; sessionId: string; taskId: string; turn: AssistantTurn; updatedAt: number }
  | { kind: 'rename'; title: string }
  | { kind: 'delete'; warning?: string }
)

export type AssistantEvent = AssistantEventChange & { sequence: number }

export interface AssistantRequests {
  settings: { input: undefined; output: { providers: AssistantProvider[]; limits: AssistantLimits } }
  saveProvider: { input: AssistantProviderInput; output: AssistantProvider }
  deleteProvider: { input: { id: string }; output: void }
  models: { input: Pick<AssistantProviderInput, 'id' | 'baseUrl' | 'apiKey'>; output: string[] }
  probe: { input: Pick<AssistantProviderInput, 'id' | 'baseUrl' | 'apiKey'> & { model: string }; output: AssistantProbeResult }
  limits: { input: AssistantLimits; output: AssistantLimits }
  mode: { input: { sessionId: string; mode: AssistantMode }; output: void }
  promptSettings: { input: { profileId?: string }; output: AssistantPromptSettings }
  savePrompt: { input: { profileId?: string; prompt: string | null }; output: AssistantPromptSettings }
  snapshot: { input: { sessionId: string; refresh?: boolean }; output: AssistantSnapshot }
  start: { input: { sessionId: string; conversationId?: string; providerId: string; model: string; prompt: string; directory: string; shareHistory: boolean }; output: { conversationId: string; taskId: string } }
  stop: { input: { sessionId: string; taskId: string }; output: void }
  answer: { input: { sessionId: string; taskId: string; questionId: string; text: string }; output: void }
  approve: { input: { sessionId: string; taskId: string; approvalId: string; approved: boolean }; output: void }
  output: { input: { sessionId: string; taskId: string; executionId: string; page: number }; output: AssistantOutput[] }
  supplement: { input: { sessionId: string; taskId: string; text: string }; output: void }
  renameConversation: { input: { sessionId: string; conversationId: string; title: string }; output: void }
  deleteConversation: { input: { sessionId: string; conversationId: string }; output: void }
}

export type AssistantRequest = { [K in keyof AssistantRequests]: { action: K; input: AssistantRequests[K]['input'] } }[keyof AssistantRequests]
