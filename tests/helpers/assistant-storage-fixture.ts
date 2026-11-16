import assert from 'node:assert/strict'
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as pause } from 'node:timers/promises'
import type { Client } from 'ssh2'
import { applyLanguage } from '../../src/main/language'
import { assistantDirectory } from '../../src/main/assistant-prompt'
import { sessions } from '../../src/main/runtime'
import { configureStateFiles, endpointKey, writeState } from '../../src/main/state-store'
import { approveAssistantAction, assistantPromptSettings, assistantSnapshot, deleteAssistantConversation, renameAssistantConversation, setAssistantMode, setAssistantPrompt, startAssistantTask, stopAssistantTask } from '../../src/main/assistant-runtime'
import {
  configureAssistantStorage, decryptAssistantData, encryptAssistantData, publicAssistantProvider,
  readAssistantMode, readAssistantHistory, readAssistantSettings, readAssistantOutput, readAssistantPrompt, saveAssistantOutput, saveAssistantPrompt, saveAssistantMode, saveAssistantConversation, saveAssistantSettings, removeAssistantConversation,
} from '../../src/main/assistant-storage'

/** Verifies OS-backed encryption and JSON round trips in the real Electron main process. */
async function verify(): Promise<void> {
  const directory = process.argv[2]
  app.setPath('userData', directory)
  await app.whenReady()
  configureAssistantStorage(directory)
  assert.equal(readAssistantMode('fixture', 'login'), 'manual')
  saveAssistantMode('fixture', 'login', 'automatic')
  assert.equal(readAssistantMode('fixture', 'login'), 'automatic')
  assert.equal(readAssistantMode('fixture', 'sudo-root'), 'manual')
  assert.equal(readAssistantMode('changed-fingerprint', 'login'), 'manual')
  const initial = readAssistantSettings()
  assert.deepEqual(initial.providers, [])
  const key = 'fixture-private-api-key'
  const provider = { id: randomUUID(), name: 'Relay', baseUrl: 'https://example.com/v1',
    models: ['mock'], defaultModel: 'mock', ciphertext: encryptAssistantData(key) }
  saveAssistantSettings({ ...initial, providers: [provider] })
  const [stored] = readAssistantSettings().providers
  assert.equal(decryptAssistantData(stored.ciphertext!), key)
  assert.deepEqual(publicAssistantProvider(stored), { id: provider.id, name: 'Relay', baseUrl: provider.baseUrl,
    models: ['mock'], defaultModel: 'mock', hasKey: true })
  assert(!readFileSync(join(directory, 'assistant-settings.json'), 'utf8').includes(key))
  const turns = [{ id: randomUUID(), prompt: 'fixture-private-prompt', directory: '/', providerId: provider.id,
    model: 'mock', mode: 'manual' as const, approvals: [], questions: [], text: 'fixture-private-response', status: 'done' as const, tools: [], activity: [{ kind: 'text' as const, text: 'fixture-private-response' }], transcript: [], supplements: [] }]
  const conversations = [{ id: randomUUID(), turns, updatedAt: Date.now() }]
  const legacy = join(directory, 'assistant-conversations-fixture.json')
  writeFileSync(legacy, JSON.stringify({ version: 1, ciphertext: 'legacy' }))
  assert.deepEqual(readAssistantHistory('fixture'), { conversations: [], issues: [] })
  const chat = conversations[0]
  saveAssistantConversation('fixture', chat)
  assert.deepEqual(readAssistantHistory('fixture').conversations, conversations)
  const base = join(directory, 'assistant-history', 'servers', 'fixture')
  const history = readFileSync(join(base, chat.id, 'conversation.json'), 'utf8')
  assert(!history.includes(turns[0].prompt) && !history.includes(turns[0].text))
  const executionId = randomUUID()
  const output = [{ stream: 'stdout' as const, text: 'private command output' }]
  saveAssistantOutput('fixture', chat.id, executionId, 0, output)
  assert.deepEqual(readAssistantOutput('fixture', chat.id, executionId, 0), output)
  const log = join(base, chat.id, 'output', executionId, '0.json')
  assert(!readFileSync(log, 'utf8').includes(output[0].text))
  const invalid = randomUUID()
  mkdirSync(join(base, invalid))
  const invalidFile = join(base, invalid, 'conversation.json')
  writeFileSync(invalidFile, '{"version":1}')
  assert.match(readAssistantHistory('fixture').issues[0], /format/)
  assert.deepEqual(readAssistantHistory('fixture').conversations, conversations)
  writeFileSync(invalidFile, '{"ciphertext":"invalid"}')
  assert.match(readAssistantHistory('fixture').issues[0], /decrypt/)
  const blocked = randomUUID()
  mkdirSync(join(base, blocked, 'conversation.json'), { recursive: true })
  assert.throws(() => saveAssistantConversation('fixture', { ...chat, id: blocked }), /save/)
  assert.throws(() => saveAssistantConversation('fixture', { ...chat, turns: [{ ...turns[0], id: 'invalid' }] }), /format/)
  assert.equal(removeAssistantConversation('fixture', chat.id), undefined)
  assert(!existsSync(log))
  assert(existsSync(legacy))
  assert.equal(readAssistantPrompt('global'), null)
  saveAssistantPrompt('global', 'Global prompt')
  saveAssistantPrompt('server', 'Server prompt')
  assert.equal(readAssistantPrompt('global'), 'Global prompt')
  assert.equal(readAssistantPrompt('server'), 'Server prompt')
  saveAssistantPrompt('server', null)
  assert.equal(readAssistantPrompt('server'), null)
  await verifyRuntime(directory)
}

/** Exercises task-scoped approvals and next-turn settings through the actual main process runtime. */
async function verifyRuntime(directory: string): Promise<void> {
  const received: Array<{ command: string; prompt: string; mode: string; directoryLine: string }> = []
  const server = createServer(async (request, response) => {
    const body = JSON.parse((await Array.fromAsync(request)).join(''))
    const message = body.messages.filter(({ role }) => role === 'user').at(-1)
    const [context, command, directoryLine] = message.content.split('\n\n')
    const { mode } = JSON.parse(context)
    const hasResult = body.messages.at(-1).role === 'tool'
    if (!hasResult) received.push({ command, prompt: body.messages[0].content, mode, directoryLine })
    const delta = hasResult ? { content: 'Done' } : { tool_calls: [{
      index: 0, id: 'fixture-call', type: 'function', function: { name: 'exec_command',
        arguments: JSON.stringify({ command, purpose: 'Fixture' }) },
    }] }
    response.setHeader('Content-Type', 'text/event-stream')
    for (const [part, finish] of [[{ role: 'assistant', ...delta }, null], [{}, hasResult ? 'stop' : 'tool_calls']]) {
      response.write('data: ' + JSON.stringify({ id: 'fixture', created: 0, model: 'mock', object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: part, finish_reason: finish }] }) + '\n\n')
    }
    response.end('data: [DONE]\n\n')
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const provider = { id: randomUUID(), name: 'Fixture', baseUrl: 'http://127.0.0.1:' + address.port,
    models: ['mock'], defaultModel: 'mock', ciphertext: null }
  saveAssistantSettings({ ...readAssistantSettings(), providers: [provider] })
  const profile = { id: randomUUID(), name: 'Fixture', host: 'localhost', port: 22, username: 'fixture', pinned: false }
  const fingerprint = 'SHA256:' + 'A'.repeat(43)
  configureStateFiles(join(directory, 'fixture-servers.json'), join(directory, 'fixture-settings.json'))
  writeState({ profiles: [profile], hostKeys: { [endpointKey(profile)]: fingerprint }, passwords: {}, commandAliases: {} })
  // A rejected or cancelled command must never reach the SSH client in this fixture.
  const client = { exec() { throw new Error('Unexpected command execution') } } as unknown as Client
  for (const sessionId of ['owner', 'observer']) sessions.set(sessionId, {
    sessionId, kind: 'files', profileId: profile.id, hostFingerprint: fingerprint, client,
  })
  try {
    applyLanguage('zh-CN')
    assert.match(assistantPromptSettings(profile.id).defaultPrompt, /Linux 服务器/)
    applyLanguage('en')
    assert.match(assistantPromptSettings(profile.id).defaultPrompt, /You operate/)
    assert.throws(() => setAssistantPrompt('Missing server', randomUUID()))
    setAssistantPrompt('Global fixture')
    setAssistantPrompt('Server fixture', profile.id)
    const input = { sessionId: 'owner', directory: assistantDirectory.parse('/project/'), providerId: provider.id, model: 'mock', shareHistory: false }
    const a = startAssistantTask({ ...input, prompt: 'printf a' })
    const b = startAssistantTask({ ...input, prompt: 'printf b' })
    assert.throws(() => startAssistantTask({ ...input, conversationId: a.conversationId, prompt: 'Concurrent turn in the same chat' }))
    /** Reads the current turn by its stable task ID. */
    const turn = (id: string) => assistantSnapshot('owner').conversations.flatMap(({ turns }) => turns).find(({ id: taskId }) => taskId === id)!
    await until(() => Boolean(turn(a.taskId).approvals[0] && turn(b.taskId).approvals[0]))
    renameAssistantConversation('observer', a.conversationId, 'Renamed')
    assert.throws(() => deleteAssistantConversation('observer', a.conversationId))
    const first = { sessionId: 'owner', taskId: a.taskId, approvalId: turn(a.taskId).approvals[0].id, approved: false }
    assert.throws(() => approveAssistantAction({ ...first, sessionId: 'observer' }))
    assert.throws(() => approveAssistantAction({ ...first, taskId: b.taskId }))
    approveAssistantAction(first)
    assert.throws(() => approveAssistantAction(first))
    setAssistantPrompt(null, profile.id)
    setAssistantMode('owner', 'automatic')
    await until(() => turn(a.taskId).status === 'done')
    assert.equal(turn(a.taskId).tools[0].status, 'rejected')
    assert.equal(turn(a.taskId).tools[0].path, '/project')
    const reloaded = assistantSnapshot('observer', true).conversations.find(({ id }) => id === a.conversationId)!
    assert.equal(reloaded.title, 'Renamed')
    assert.deepEqual(reloaded.turns[0].transcript.map(({ role }) => role), ['user', 'assistant', 'tool', 'assistant'])
    assert.equal(turn(b.taskId).status, 'running')
    deleteAssistantConversation('observer', a.conversationId)
    assert(!assistantSnapshot('owner', true).conversations.some(({ id }) => id === a.conversationId))
    assert.equal(turn(b.taskId).mode, 'manual')
    assert.equal(assistantSnapshot('owner').running[0].taskId, b.taskId)
    stopAssistantTask('owner', b.taskId)
    await until(() => turn(b.taskId).status === 'stopped')
    assert.equal(turn(b.taskId).approvals.length, 0)
    assert.equal(turn(b.taskId).tools[0].status, 'stopped')
    // The next turn resolves the global prompt and the newly selected automatic mode.
    applyLanguage('zh-CN')
    const c = startAssistantTask({ ...input, prompt: 'printf c' })
    await until(() => turn(c.taskId).status !== 'running')
    assert.equal(turn(c.taskId).mode, 'automatic')
    assert.deepEqual(received.sort((left, right) => left.command.localeCompare(right.command)), [
      { command: 'printf a', prompt: 'Server fixture', mode: 'manual', directoryLine: 'Current directory: /project' },
      { command: 'printf b', prompt: 'Server fixture', mode: 'manual', directoryLine: 'Current directory: /project' },
      { command: 'printf c', prompt: 'Global fixture', mode: 'automatic', directoryLine: '当前目录是：/project' },
    ])
  } finally {
    server.closeAllConnections()
    server.close()
  }
}

/** Waits for a runtime event with a bounded fixture deadline. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    assert(Date.now() < deadline, 'Timed out waiting for the assistant runtime')
    await pause(20)
  }
}

void verify().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1) })
