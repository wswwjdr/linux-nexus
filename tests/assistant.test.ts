import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isStepCount, ToolLoopAgent } from 'ai'
import { build } from 'esbuild'
import { assistantChatModel, fetchAssistantModels, normalizeAssistantUrl, probeAssistantProvider } from '../src/main/assistant-provider'
import { Client, Server } from 'ssh2'
import { executeRemoteCommand, RemoteCommandError, type RemoteCommandExecutor } from '../src/main/ssh-commands'
import { assistantCommandTools, describeStdinInputFailure, type AssistantInteraction } from '../src/main/assistant-command-tools'
import { defaultAssistantPrompt } from '../src/main/assistant-prompt'
import type { AssistantOutput, AssistantTurn } from '../src/shared/types/assistant'

/** Starts a fake Chat Completions endpoint and returns its loopback API root. */
async function service(t: TestContext, reply: (request: IncomingMessage, response: ServerResponse) => void): Promise<string> {
  const server = createServer(reply).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}/v1`
}

/** Sends a valid Chat Completions answer, with a streamed shape when requested. */
function respond(response: ServerResponse, stream: boolean, delta: object, reason = 'stop'): void {
  const common = { id: 'fixture', created: 0, model: 'mock' }
  if (!stream) {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ ...common, object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', ...delta }, finish_reason: reason }] }))
    return
  }
  response.setHeader('Content-Type', 'text/event-stream')
  for (const [part, finish] of [[{ role: 'assistant', ...delta }, null], [{}, reason]]) {
    response.write('data: ' + JSON.stringify({ ...common, object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: part, finish_reason: finish }] }) + '\n\n')
  }
  response.end('data: [DONE]\n\n')
}

/** Produces one OpenAI function call to send from the mock endpoint. */
function call(name: string, input: object, index = 0, id = name): object {
  return { tool_calls: [{ id: 'tool_' + id, index, type: 'function', function: { name, arguments: JSON.stringify(input) } }] }
}

test('fetches model IDs and verifies ordinary chat, streaming and a tool round trip', async (t) => {
  let calls = 0
  const baseUrl = await service(t, async (request, response) => {
    if (request.headers.authorization !== 'Bearer fixture-key') {
      response.writeHead(401).end('{}')
      return
    }
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'mock' }, { id: 'mock' }, { id: 'other' }] }))
      return
    }
    assert.equal(request.url, '/v1/chat/completions')
    const body = JSON.parse((await Array.fromAsync(request)).join(''))
    calls += 1
    if (body.tools && !body.messages.some(({ role }: { role: string }) => role === 'tool')) respond(response, false, call('check', {}), 'tool_calls')
    else respond(response, Boolean(body.stream), { content: 'OK' })
  })
  assert.deepEqual(await fetchAssistantModels({ baseUrl, apiKey: 'fixture-key' }), ['mock', 'other'])
  assert.deepEqual(await probeAssistantProvider({ baseUrl, apiKey: 'fixture-key', model: 'mock' }),
    { authentication: 'ok', chat: 'ok', stream: 'ok', tools: 'ok' })
  assert.equal(calls, 4)
  await assert.rejects(fetchAssistantModels({ baseUrl }), /401/)
  const denied = await probeAssistantProvider({ baseUrl, model: 'mock' })
  assert.equal(denied.authentication, 'failed')
  assert.equal(denied.chat, 'failed')
  assert.throws(() => normalizeAssistantUrl('http://example.com/v1'))
  assert.throws(() => normalizeAssistantUrl('https://example.com/v1/chat/completions'))
})

/** Creates isolated tool state and a pageable in-memory log for a test turn. */
function fixture(commands: RemoteCommandExecutor, mode: AssistantTurn['mode'], interact: AssistantInteraction = async () => true) {
  const turn: AssistantTurn = { id: randomUUID(), directory: '/project', mode, model: 'mock', providerId: 'fixture',
    prompt: 'fixture', text: '', status: 'running', approvals: [], questions: [], activity: [], tools: [], transcript: [], supplements: [] }
  const pages = new Map<string, AssistantOutput[]>()
  const controller = new AbortController()
  const command = assistantCommandTools({ commands, signal: controller.signal, turn, interact,
    update: () => {}, checkpoint: () => {},
    save: (id, page, output) => pages.set(id + ':' + page, structuredClone(output)),
    read: (id, page) => pages.get(id + ':' + page)!,
  })
  return { ...command, turn, pages, controller }
}

test('streams a model-selected command and its nonzero exit code through the generic tool', async (t) => {
  let step = 0
  const baseUrl = await service(t, async (request, response) => {
    const body = JSON.parse((await Array.fromAsync(request)).join(''))
    assert.deepEqual(body.tools.map(({ function: entry }) => entry.name).sort(),
      ['ask_user', 'exec_command', 'stop_process', 'wait_process', 'write_stdin'])
    if (++step === 1) {
      return respond(response, true, call('exec_command', { command: 'printf "%s\n" 11261; exit 4', purpose: 'Check configuration' }), 'tool_calls')
    }
    const result = JSON.parse(body.messages.at(-1).content)
    assert.equal(result.exitCode, 4)
    assert.match(JSON.stringify(result.output), /11261/)
    return respond(response, true, { content: 'Found port 11261, command exited with code 4.' })
  })
  const { tools, turn } = fixture({ async execute(command, options) {
    assert.match(command, /\/project/)
    assert.match(command, /printf[\s\S]*11261/)
    options?.onStdout?.(Buffer.from('11261\n'))
    throw new RemoteCommandError(4, '')
  } }, 'automatic', async () => { throw new Error('Unexpected approval') })
  const agent = new ToolLoopAgent({ model: assistantChatModel({ baseUrl }, 'mock'), instructions: defaultAssistantPrompt.en,
    maxRetries: 0, stopWhen: isStepCount(4), tools })
  const reply = await agent.stream({ prompt: 'Get the backend port' })
  await reply.consumeStream()
  assert.equal(await reply.text, 'Found port 11261, command exited with code 4.')
  assert.deepEqual(turn.tools.map(({ status, exitCode }) => ({ status, exitCode })), [{ status: 'failed', exitCode: 4 }])
})

test('manual rejection prevents execution and active executions cannot be addressed by a different turn', async () => {
  let calls = 0
  const commands: RemoteCommandExecutor = { async execute() {
    calls++
    return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0 }
  } }
  const rejected = fixture(commands, 'manual', async (request) => {
    assert('kind' in request && request.kind === 'command')
    return false
  })
  const options = { toolCallId: 'fixture', messages: [] }
  await rejected.tools.exec_command.execute!({ command: 'pwd', purpose: 'Current directory' }, options)
  assert.equal(calls, 0)
  assert.equal(rejected.turn.tools[0].status, 'rejected')
  const accepted = fixture(commands, 'automatic')
  await accepted.tools.exec_command.execute!({ command: 'pwd', purpose: 'Current directory' }, options)
  assert.equal(calls, 1)
  const foreign = await rejected.tools.wait_process.execute!({ executionId: accepted.turn.tools[0].id, cursor: 0 }, options)
  assert('error' in foreign)
})

test('returns paginated output, approves ordinary input and EOF, and reports a lost connection', async () => {
  const input: string[] = []
  const requests: string[] = []
  const { tools, turn } = fixture({ async execute(_command, options) {
    options?.onStdout?.(Buffer.from('a'.repeat(8191) + '🙂' + 'b'.repeat(8192)))
    for await (const value of options!.stdin!) {
      const bytes = Buffer.from(value)
      input.push(bytes.toString())
      options!.onStdin?.(bytes)
    }
    throw new RemoteCommandError(null, '')
  } }, 'manual', async (request) => {
    assert('kind' in request)
    requests.push(request.kind)
    return true
  })
  const options = { toolCallId: 'fixture', messages: [] }
  const start = await tools.exec_command.execute!({ command: 'fixture', purpose: 'Read data' }, options)
  assert('executionId' in start)
  assert.equal(start.output[0].text.length, 8191)
  assert(start.more)
  const { executionId } = start
  const next = await tools.wait_process.execute!({ executionId, cursor: start.cursor }, options)
  assert('output' in next)
  assert(next.output[0].text.startsWith('🙂'))
  await tools.write_stdin.execute!({ executionId, text: 'continue\n' }, options)
  await tools.write_stdin.execute!({ executionId, text: null }, options)
  await tools.wait_process.execute!({ executionId, cursor: 3 }, options)
  assert.deepEqual(input, ['continue\n'])
  assert.deepEqual(requests, ['command', 'input', 'eof'])
  assert.equal(turn.tools[0].status, 'unknown')
})

test('uses real SSH channels for PTY, secret input, split UTF-8 output and independent cancellation', async (t) => {
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    .export({ type: 'pkcs1', format: 'pem' })
  const password = 'fixture-secrét'
  let cancellations = 0
  let pty = false
  const server = new Server({ hostKeys: [hostKey] }, (peer) => {
    peer.on('authentication', (auth) => auth.accept())
    peer.on('ready', () => peer.on('session', (accept) => {
      const session = accept()
      session.on('pty', (acceptPty, _reject, info) => {
        assert.equal(info.term, 'dumb')
        pty = true
        acceptPty?.()
      })
      session.on('exec', (acceptExec, _reject, info) => {
        const channel = acceptExec()
        if (info.command.includes('secret-fixture')) {
          channel.write('Password: ')
          channel.once('data', (buffer: Buffer) => {
            assert.equal(buffer.toString(), password + '\n')
            const bytes = Buffer.from(password + ' 端口 11261\n')
            channel.write(bytes.subarray(0, 7))
            channel.write(bytes.subarray(7, 13))
            channel.write(bytes.subarray(13))
            channel.stderr.write('diagnostic\n')
            channel.exit(0)
            channel.end()
          })
        } else {
          channel.write('waiting\n')
          session.on('signal', (_accept, _reject, info) => {
            assert.equal(info.name, 'TERM')
            cancellations++
            channel.exit(143)
            channel.end()
          })
        }
      })
    }))
  }).listen(0, '127.0.0.1')
  const client = new Client()
  t.after(() => { client.destroy(); server.close() })
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  client.connect({ host: '127.0.0.1', port: address.port, username: 'fixture' })
  await once(client, 'ready')
  const commands = { execute: (command, options) => executeRemoteCommand(client, command, options) } satisfies RemoteCommandExecutor
  const a = fixture(commands, 'automatic')
  const b = fixture(commands, 'manual', async (request) => 'kind' in request ? true : password)
  const options = { toolCallId: 'fixture', messages: [] }
  await a.tools.exec_command.execute!({ command: 'long-fixture', purpose: 'Wait' }, options)
  await b.tools.exec_command.execute!({ command: 'secret-fixture', purpose: 'Read configuration', pty: true }, options)
  const executionId = b.turn.tools[0].id
  assert(pty)
  assert.deepEqual(await b.tools.ask_user.execute!({ question: 'Password', executionId }, options), { status: 'sent' })
  await a.close()
  await b.tools.wait_process.execute!({ executionId, cursor: 1, waitMs: 5_000 }, options)
  assert.equal(a.turn.tools[0].status, 'stopped')
  assert.equal(cancellations, 1)
  assert.equal(b.turn.tools[0].status, 'done')
  assert(!JSON.stringify(b.turn).includes(password))
  assert(!JSON.stringify([...b.pages.values()]).includes(password))
  const all = [...b.pages.values()].flat()
  assert.match(all.filter(({ stream }) => stream === 'stdout').map(({ text }) => text).join(''), /\[redacted\] 端口 11261/)
  assert.equal(all.filter(({ stream }) => stream === 'stderr').map(({ text }) => text).join(''), 'diagnostic\n')
})

test('keeps keys and conversation content encrypted in Electron storage', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-assistant-storage-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const fixture = join(directory, 'verify.cjs')
  await build({ entryPoints: [fileURLToPath(new URL('./helpers/assistant-storage-fixture.ts', import.meta.url))],
    outfile: fixture, platform: 'node', bundle: true, external: ['electron'] })
  const { default: electron } = await import('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron as unknown as string, [fixture, directory], { env, windowsHide: true, timeout: 30_000 })
  let output = ''
  child.stderr.on('data', (chunk: Buffer) => { output += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, output)
})

test('reports which write_stdin fields are invalid without exposing parameter contents', () => {
  const diagnosis = describeStdinInputFailure(JSON.stringify({ executionId: 'private-value', chars: 'private-input' }))
  assert.match(diagnosis, /executionId/)
  assert.match(diagnosis, /text/)
  assert.doesNotMatch(diagnosis, /private-value|private-input|chars/)
  assert.match(describeStdinInputFailure('{'), /JSON/)
})

test('handles native transcript scrolling, history actions and prompt drafts in a real Electron renderer', { skip: process.platform !== 'win32' }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-assistant-ui-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await build({
    entryPoints: [fileURLToPath(new URL('./helpers/assistant-ui-fixture.tsx', import.meta.url))],
    outfile: join(directory, 'ui.js'), platform: 'browser', bundle: true, define: { 'process.env.NODE_ENV': '"production"' },
  })
  const styles = ['theme.css', 'foundation.css', 'workspace.css', 'rich-previews.css', 'assistant.css']
  await Promise.all(styles.map((name) => copyFile(new URL('../src/renderer/src/styles/' + name, import.meta.url), join(directory, name))))
  await writeFile(join(directory, 'index.html'), [
    '<!doctype html><meta charset="utf-8">',
    ...styles.map((name) => '<link rel="stylesheet" href="' + name + '">'),
    '<script defer src="./ui.js"></script>',
  ].join(''))
  const fixture = join(directory, 'ui.cjs')
  await copyFile(new URL('./helpers/assistant-ui-browser.cjs', import.meta.url), fixture)
  const { default: electron } = await import('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(electron as unknown as string, [fixture, directory], { env, windowsHide: true, timeout: 30_000 })
  let output = ''
  child.stderr.on('data', (chunk: Buffer) => { output += chunk })
  const [code] = await once(child, 'close')
  assert.equal(code, 0, output)
})
