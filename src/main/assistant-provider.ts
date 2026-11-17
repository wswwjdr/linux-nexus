import { APICallError, generateText, streamText, tool } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { z } from 'zod'
import { LocalizedError, msg, renderMessage } from '../shared/i18n/messages'
import type { AssistantProbeResult } from '../shared/types/assistant'
import { modelId } from '../shared/assistant-settings'
import { decryptAssistantData, readAssistantSettings, type StoredProvider } from './assistant-storage'

export interface ProviderCredentials { id?: string; baseUrl: string; apiKey?: string | null }

/** Normalizes an API root and permits HTTP only for loopback development services. */
export function normalizeAssistantUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new LocalizedError(msg('assistant.urlInvalid'))
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    || url.username || url.password || url.search || url.hash || /\/(chat\/completions|models|responses)\/?$/.test(url.pathname)) {
    throw new LocalizedError(msg('assistant.urlInvalid'))
  }
  return url.href.replace(/\/+$/, '')
}

/** Looks up a saved provider by id, or reports that it no longer exists. */
export function assistantProvider(id: string): StoredProvider {
  const provider = readAssistantSettings().providers.find((item) => item.id === id)
  if (!provider) throw new LocalizedError(msg('assistant.providerMissing'))
  return provider
}

/** Resolves temporary or saved credentials without reusing a key at another URL. */
function resolveCredentials(input: ProviderCredentials) {
  const baseUrl = normalizeAssistantUrl(input.baseUrl)
  const previous = input.id ? assistantProvider(input.id) : undefined
  const apiKey = input.apiKey === undefined && previous?.baseUrl === baseUrl && previous.ciphertext
    ? decryptAssistantData(previous.ciphertext) : input.apiKey
  return { baseUrl, apiKey }
}

/** Creates a Chat Completions model, rejecting redirects before any credential forwarding. */
export function assistantChatModel(input: ProviderCredentials, model: string, requestTimeoutMs?: number) {
  const { baseUrl, apiKey } = resolveCredentials(input)
  return createOpenAICompatible({
    name: 'linux-nexus', baseURL: baseUrl, apiKey: apiKey ?? undefined,
    fetch: (request, init) => {
      const timeout = requestTimeoutMs === undefined ? undefined : AbortSignal.timeout(requestTimeoutMs)
      const signal = timeout && init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout ?? init?.signal
      return fetch(request, { ...init, signal, redirect: 'error' })
    },
  }).chatModel(model)
}

/** Lists model IDs from the configured endpoint. */
export async function fetchAssistantModels(input: ProviderCredentials): Promise<string[]> {
  const { baseUrl, apiKey } = resolveCredentials(input)
  try {
    const response = await fetch(baseUrl + '/models', {
      headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : undefined,
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new LocalizedError(msg('assistant.httpError', { status: response.status }))
    }
    const reader = response.body?.getReader()
    if (!reader) throw new LocalizedError(msg('assistant.modelListError'))
    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        total += chunk.value.byteLength
        if (total > 2 * 1024 * 1024) throw new LocalizedError(msg('assistant.modelListError'))
        chunks.push(chunk.value)
      }
    } finally {
      await reader.cancel()
    }
    const { data } = z.object({ data: z.array(z.object({ id: modelId })) })
      .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    const ids = [...new Set(data.map(({ id }) => id))].sort().slice(0, 500)
    if (!ids.length) throw new LocalizedError(msg('assistant.modelListError'))
    return ids
  } catch (error) {
    if (error instanceof LocalizedError) throw error
    throw new LocalizedError(msg('assistant.modelListError'))
  }
}

/** Converts model failures to diagnostics that exclude response bodies and credentials. */
export function providerFailure(error: unknown): string {
  if (error instanceof LocalizedError) return renderMessage(error.localizedMessage)
  if (APICallError.isInstance(error) && error.statusCode) return renderMessage(msg('assistant.httpError', { status: error.statusCode }))
  if (error instanceof Error && error.name === 'TimeoutError') return renderMessage(msg('assistant.timeout'))
  return renderMessage(msg('assistant.modelError'))
}

/** Probes chat, streaming and a harmless tool round trip using synthetic inputs. */
export async function probeAssistantProvider(input: ProviderCredentials & { model: string }): Promise<AssistantProbeResult> {
  const model = assistantChatModel(input, input.model)
  const settings = { model, maxRetries: 0, maxOutputTokens: 64, timeout: 20_000 }
  const result: AssistantProbeResult = { authentication: 'unverified' }
  try {
    const reply = await generateText({ ...settings, prompt: 'Reply with OK.' })
    result.authentication = 'ok'
    result.chat = reply.text.trim() ? 'ok' : 'failed'
  } catch (error) {
    result.authentication = APICallError.isInstance(error) && [401, 403].includes(error.statusCode ?? 0) ? 'failed' : 'unverified'
    return { ...result, chat: 'failed', detail: providerFailure(error) }
  }
  try {
    let receivedText = false
    for await (const part of streamText({ ...settings, prompt: 'Reply with OK.' }).fullStream) {
      if (part.type === 'error') throw part.error
      if (part.type === 'text-delta') receivedText ||= Boolean(part.text.trim())
    }
    result.stream = receivedText ? 'ok' : 'failed'
  } catch (error) {
    result.stream = 'failed'
    result.detail = providerFailure(error)
  }
  try {
    const tools = { check: tool({
      inputSchema: z.strictObject({}),
      /** Returns a fixed value to verify the service can accept tool results. */
      execute: async () => 'OK',
    }) }
    const call = await generateText({ ...settings, tools, prompt: 'Call the check tool with an empty object.' })
    if (!call.toolResults.length) return { ...result, tools: 'failed' }
    const reply = await generateText({ ...settings, tools, toolChoice: 'none',
      messages: [{ role: 'user', content: 'Call check, then reply with OK.' }, ...call.response.messages] })
    result.tools = reply.text.trim() ? 'ok' : 'failed'
  } catch (error) {
    result.tools = 'failed'
    result.detail ??= providerFailure(error)
  }
  return result
}
