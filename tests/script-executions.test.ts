import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import type { ScriptExecutionEvent, ScriptExecutionRequest } from '../src/shared/types.ts'
import { ScriptExecutionManager, buildScriptExecutionCommand } from '../src/main/script-executions.ts'

class FakeChannel extends EventEmitter {
  stderr = new EventEmitter()
  signals: string[] = []
  closeCalls = 0

  signal(name: string): void {
    this.signals.push(name)
  }

  close(): void {
    this.closeCalls += 1
  }
}

class FakeClient extends EventEmitter {
  commands: string[] = []
  callback: ((error: Error | undefined, stream: ClientChannel) => void) | null = null

  exec(command: string, callback: (error: Error | undefined, stream: ClientChannel) => void): void {
    this.commands.push(command)
    this.callback = callback
  }

  open(channel = new FakeChannel()): FakeChannel {
    assert.ok(this.callback)
    this.callback(undefined, channel as unknown as ClientChannel)
    return channel
  }
}

function createHarness() {
  const client = new FakeClient()
  const events: ScriptExecutionEvent[] = []
  const request: ScriptExecutionRequest = {
    requestId: 'execution-1',
    sessionId: 'session-1',
    scriptPath: "/opt/jobs/O'Brien files/watch;$x.sh",
    command: './watch.sh',
  }
  const manager = new ScriptExecutionManager(
    (sessionId) => sessionId === request.sessionId
      ? { sessionId, profileId: 'profile-1', kind: 'sftp', client: client as unknown as Client, sftp: {} as never }
      : undefined,
    (event) => events.push(event),
  )
  return { client, events, manager, request }
}

test('builds a quoted working-directory command without changing the user command', () => {
  assert.equal(
    buildScriptExecutionCommand("/opt/jobs/O'Brien files/watch;$x.sh", 'tail -f "watch log.txt"'),
    "cd -- '/opt/jobs/O'\\''Brien files' && exec sh -c 'tail -f \"watch log.txt\"'",
  )
  assert.throws(() => buildScriptExecutionCommand('/', 'true'))
})

test('streams UTF-8 stdout and stderr and completes once after a successful exit', () => {
  const { client, events, manager, request } = createHarness()
  manager.start(request)
  assert.equal(client.commands[0], "cd -- '/opt/jobs/O'\\''Brien files' && exec sh -c './watch.sh'")
  const channel = client.open()
  const utf8 = Buffer.from('你好')
  channel.emit('data', utf8.subarray(0, 2))
  channel.emit('data', utf8.subarray(2))
  channel.stderr.emit('data', Buffer.from('warning\n'))
  channel.emit('exit', 0)
  channel.emit('close')
  channel.emit('close')

  assert.deepEqual(events, [
    { type: 'output', requestId: request.requestId, sessionId: request.sessionId, stream: 'stdout', data: '你好' },
    { type: 'output', requestId: request.requestId, sessionId: request.sessionId, stream: 'stderr', data: 'warning\n' },
    { type: 'completed', requestId: request.requestId, sessionId: request.sessionId, exitCode: 0 },
  ])
})

test('reports nonzero exit codes and cancels a running channel only once', () => {
  const { client, events, manager, request } = createHarness()
  manager.start(request)
  const channel = client.open()
  channel.stderr.emit('data', Buffer.from('not found\n'))
  channel.emit('exit', 127)
  channel.emit('close')
  assert.deepEqual(events.at(-1), {
    type: 'failed', requestId: request.requestId, sessionId: request.sessionId,
    exitCode: 127, message: '脚本执行失败，退出码 127',
  })

  const cancelled = createHarness()
  cancelled.manager.start(cancelled.request)
  const runningChannel = cancelled.client.open()
  assert.equal(cancelled.manager.cancel(cancelled.request.requestId), true)
  assert.equal(cancelled.manager.cancel(cancelled.request.requestId), false)
  assert.deepEqual(runningChannel.signals, ['TERM'])
  assert.equal(runningChannel.closeCalls, 1)
  assert.deepEqual(cancelled.events.map((event) => event.type), ['cancelled'])
})

test('cancels a channel that opens after cancellation and fails tasks on session loss once', () => {
  const pending = createHarness()
  pending.manager.start(pending.request)
  assert.equal(pending.manager.cancel(pending.request.requestId), true)
  const lateChannel = pending.client.open()
  assert.deepEqual(lateChannel.signals, ['TERM'])
  assert.equal(lateChannel.closeCalls, 1)
  assert.deepEqual(pending.events.map((event) => event.type), ['cancelled'])

  const disconnected = createHarness()
  disconnected.manager.start(disconnected.request)
  const channel = disconnected.client.open()
  disconnected.manager.failForSession(disconnected.request.sessionId, '连接已关闭')
  disconnected.client.emit('close')
  channel.emit('close')
  assert.deepEqual(disconnected.events.map((event) => event.type), ['failed'])
  assert.deepEqual(disconnected.events[0], {
    type: 'failed', requestId: disconnected.request.requestId, sessionId: disconnected.request.sessionId,
    message: 'SSH 连接中断：连接已关闭',
  })
})
