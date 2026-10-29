import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { cancelRemoteOperation, composeRemoteOperation, executeRemoteOperation } from '../src/main/remote-operations.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'
import type { RemoteOperationIntent } from '../src/shared/types.ts'

class MockChannel extends EventEmitter {
  stderr = new EventEmitter()
  signals: string[] = []
  onEnd?: (channel: MockChannel) => void

  end(): void {
    this.onEnd?.(this)
  }

  signal(signal: string): void {
    this.signals.push(signal)
    queueMicrotask(() => {
      this.emit('exit', 143)
      this.emit('close', 143)
    })
  }

  close(): void {
    queueMicrotask(() => {
      this.emit('exit', 143)
      this.emit('close', 143)
    })
  }

  complete(stdout = Buffer.alloc(0), exitCode = 0): void {
    if (stdout.length) this.emit('data', stdout)
    this.emit('exit', exitCode)
    this.emit('close', exitCode)
  }
}

function mockClient(respond: (command: string, index: number, channel: MockChannel) => void) {
  const commands: string[] = []
  const channels: MockChannel[] = []
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new MockChannel()
    const index = commands.push(command) - 1
    channels.push(channel)
    respond(command, index, channel)
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  return { client, commands, channels }
}

function copyIntent(strategy: RemoteOperationIntent['strategy'] = 'confirm'): RemoteOperationIntent {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    operation: 'copy',
    sourcePaths: ['/home/space name', '/home/中文\n文件'],
    targetDirectory: '/home/target',
    strategy,
  }
}

function attachSession(client: Client): void {
  sessions.set('session-1', { sessionId: 'session-1', client, kind: 'files', profileId: 'profile-1' })
}

test('composes native cp and mv command previews locally without contacting the server', () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    const source = "/home/space ' quote\n中文"
    const copy = composeRemoteOperation({ ...copyIntent(), sourcePaths: [source] })
    assert.equal(remote.commands.length, 0)
    assert.ok(copy.commandPreviews.force.includes('cp -R --preserve=mode,timestamps -f -- "$@"'))
    assert.ok(copy.commandPreviews.skip.includes('cp -R --preserve=mode,timestamps -n -- "$@"'))
    assert.ok(copy.commandPreviews.update.includes('cp -R --preserve=mode,timestamps -u -- "$@"'))
    assert.ok(copy.commandPreviews.force.includes(shellQuote(source)))

    const move = composeRemoteOperation({ ...copyIntent(), operation: 'move' })
    assert.ok(move.commandPreviews.force.includes('mv -f -- "$@"'))
    assert.ok(move.commandPreviews.skip.includes('mv -n -- "$@"'))
    assert.ok(move.commandPreviews.update.includes('mv -u -- "$@"'))
  } finally {
    sessions.delete('session-1')
  }
})

test('executes the selected copy policy in one server command after confirmation', async () => {
  const remote = mockClient((_command, _index, channel) => {
    channel.onEnd = (current) => current.complete()
  })
  attachSession(remote.client)
  try {
    composeRemoteOperation(copyIntent())
    assert.equal(remote.commands.length, 0)

    const result = await executeRemoteOperation({ ...copyIntent('skip'), strategy: 'skip' })
    assert.equal(result.status, 'completed')
    assert.equal(remote.commands.length, 1)
    assert.ok(remote.commands[0].includes('cp -R --preserve=mode,timestamps -n -- "$@"'))
    assert.ok(!remote.commands[0].includes('mktemp'))
    assert.ok(!remote.commands[0].includes('find --'))
  } finally {
    sessions.delete('session-1')
  }
})

test('executes extraction directly into the selected destination without staging or scanning', async () => {
  const remote = mockClient((_command, _index, channel) => {
    channel.onEnd = (current) => current.complete()
  })
  attachSession(remote.client)
  const intent: RemoteOperationIntent = {
    requestId: 'archive-request',
    sessionId: 'session-1',
    operation: 'extract',
    sourcePaths: [],
    targetDirectory: '/home/target',
    archivePath: '/home/release.tar.gz',
    wrapInDirectory: true,
    strategy: 'confirm',
  }
  try {
    const confirmation = composeRemoteOperation(intent)
    assert.equal(confirmation.outputDirectory, '/home/target/release')
    assert.ok(confirmation.commandPreviews.skip.includes('mkdir -p -- "$output"'))
    assert.ok(confirmation.commandPreviews.skip.includes('tar --no-same-owner --no-same-permissions --skip-old-files -xzf'))
    assert.ok(!confirmation.commandPreviews.skip.includes('mktemp'))
    assert.ok(!confirmation.commandPreviews.skip.includes('find --'))

    const result = await executeRemoteOperation({ ...intent, strategy: 'skip' })
    assert.equal(result.status, 'completed')
    assert.equal(remote.commands.length, 1)
    assert.ok(remote.commands[0].includes('tar --no-same-owner --no-same-permissions --skip-old-files -xzf'))
  } finally {
    sessions.delete('session-1')
  }
})

test('cancels the active final server command by sending TERM through its channel', async () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    const pending = executeRemoteOperation({ ...copyIntent('force'), strategy: 'force' })
    assert.equal(cancelRemoteOperation('request-1'), true)
    const result = await pending
    assert.equal(result.status, 'cancelled')
    assert.deepEqual(remote.channels[0].signals, ['TERM'])
  } finally {
    sessions.delete('session-1')
  }
})
