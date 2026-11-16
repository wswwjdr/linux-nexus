import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { LocalizedError, msg } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import { fetchAssistantModels, normalizeAssistantUrl, probeAssistantProvider } from '../assistant-provider'
import { assistantId, assistantModeSchema, assistantPromptSchema, encryptAssistantData, limitsSchema, modelId, publicAssistantProvider, readAssistantSettings, saveAssistantSettings } from '../assistant-storage'
import { setAssistantMode, assistantPromptSettings, setAssistantPrompt, assistantOutput, approveAssistantAction, answerAssistantQuestion, assistantSnapshot, deleteAssistantConversation, renameAssistantConversation, startAssistantTask, stopAssistantTask, supplementAssistantTask } from '../assistant-runtime'
import { assistantDirectory } from '../assistant-prompt'

const connection = {
  id: assistantId.optional(),
  baseUrl: z.string().trim().min(1).max(2048),
  apiKey: z.string().trim().min(1).max(4096).regex(/^[!-~]+$/).nullable().optional(),
}
const session = { sessionId: z.string().min(1).max(128) }
const conversation = { ...session, conversationId: assistantId }
const task = { ...session, taskId: assistantId }
const request = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('settings'), input: z.undefined() }),
  z.strictObject({ action: z.literal('saveProvider'), input: z.strictObject({
    ...connection, name: z.string().trim().min(1).max(100), models: z.array(modelId).min(1).max(500), defaultModel: modelId,
  }) }),
  z.strictObject({ action: z.literal('deleteProvider'), input: z.strictObject({ id: assistantId }) }),
  z.strictObject({ action: z.literal('models'), input: z.strictObject(connection) }),
  z.strictObject({ action: z.literal('probe'), input: z.strictObject({ ...connection, model: modelId }) }),
  z.strictObject({ action: z.literal('limits'), input: limitsSchema }),
  z.strictObject({ action: z.literal('mode'), input: z.strictObject({ ...session, mode: assistantModeSchema }) }),
  z.strictObject({ action: z.literal('promptSettings'), input: z.strictObject({ profileId: session.sessionId.min(1).optional() }) }),
  z.strictObject({ action: z.literal('savePrompt'), input: z.strictObject({ profileId: session.sessionId.min(1).optional(), prompt: assistantPromptSchema }) }),
  z.strictObject({ action: z.literal('snapshot'), input: z.strictObject({ ...session, refresh: z.boolean().optional() }) }),
  z.strictObject({ action: z.literal('start'), input: z.strictObject({
    ...session, conversationId: assistantId.optional(), providerId: assistantId, model: modelId, prompt: z.string().trim().min(1).max(16000),
    directory: assistantDirectory, shareHistory: z.boolean(),
  }) }),
  z.strictObject({ action: z.literal('stop'), input: z.strictObject({ ...session, taskId: assistantId }) }),
  z.strictObject({ action: z.literal('answer'), input: z.strictObject({ ...task, questionId: assistantId, text: z.string().min(1).max(16000) }) }),
  z.strictObject({ action: z.literal('approve'), input: z.strictObject({ ...task, approvalId: assistantId, approved: z.boolean() }) }),
  z.strictObject({ action: z.literal('output'), input: z.strictObject({ ...task, executionId: assistantId, page: z.int().nonnegative() }) }),
  z.strictObject({ action: z.literal('supplement'), input: z.strictObject({ ...session, taskId: assistantId, text: z.string().trim().min(1).max(16000) }) }),
  z.strictObject({ action: z.literal('renameConversation'), input: z.strictObject({ ...conversation, title: z.string().trim().min(1).max(120) }) }),
  z.strictObject({ action: z.literal('deleteConversation'), input: z.strictObject(conversation) }),
])

/** Registers the typed assistant IPC endpoint and validates requests from the renderer. */
export function registerAssistantIpc(): void {
  ipcMain.handle('assistant:request', (_event, payload: unknown) => {
    const parsed = request.safeParse(payload)
    if (!parsed.success) throw new LocalizedError(msg('assistant.invalid'))
    const { action, input } = parsed.data
    switch (action) {
      case 'settings': {
        const { providers, limits } = readAssistantSettings()
        return { providers: providers.map(publicAssistantProvider), limits }
      }
      case 'saveProvider': {
        const state = readAssistantSettings()
        const previous = state.providers.find((item) => item.id === input.id)
        if (input.id && !previous) throw new LocalizedError(msg('assistant.providerMissing'))
        const baseUrl = normalizeAssistantUrl(input.baseUrl)
        const models = [...new Set(input.models)]
        if (!models.includes(input.defaultModel)) throw new LocalizedError(msg('assistant.invalid'))
        const provider = { id: previous?.baseUrl === baseUrl ? previous.id : randomUUID(), name: input.name,
          baseUrl, models, defaultModel: input.defaultModel,
          ciphertext: input.apiKey ? encryptAssistantData(input.apiKey) : input.apiKey === undefined && previous?.baseUrl === baseUrl ? previous.ciphertext : null }
        state.providers = [...state.providers.filter((item) => item.id !== input.id), provider]
        saveAssistantSettings(state)
        return publicAssistantProvider(provider)
      }
      case 'deleteProvider': {
        const state = readAssistantSettings()
        saveAssistantSettings({ ...state, providers: state.providers.filter((item) => item.id !== input.id) })
        return
      }
      case 'models': return fetchAssistantModels(input)
      case 'probe': return probeAssistantProvider(input)
      case 'limits': {
        const state = readAssistantSettings()
        saveAssistantSettings({ ...state, limits: input })
        return input
      }
      case 'mode': return setAssistantMode(input.sessionId, input.mode)
      case 'promptSettings': return assistantPromptSettings(input.profileId)
      case 'savePrompt': return setAssistantPrompt(input.prompt, input.profileId)
      case 'snapshot': return assistantSnapshot(input.sessionId, input.refresh)
      case 'start': return startAssistantTask(input)
      case 'stop': return stopAssistantTask(input.sessionId, input.taskId)
      case 'answer': return answerAssistantQuestion(input)
      case 'approve': return approveAssistantAction(input)
      case 'output': return assistantOutput(input)
      case 'supplement': return supplementAssistantTask(input.sessionId, input.taskId, input.text)
      case 'renameConversation': return renameAssistantConversation(input.sessionId, input.conversationId, input.title)
      case 'deleteConversation': return deleteAssistantConversation(input.sessionId, input.conversationId)
    }
  })
}
