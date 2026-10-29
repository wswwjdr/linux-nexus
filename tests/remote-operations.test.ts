import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { cancelRemoteOperation, executeRemoteOperation } from '../src/main/remote-operations.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'
import type { OperationExecutionRequest } from '../src/shared/types.ts'

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

function copyRequest(strategy: OperationExecutionRequest['strategy'] = 'force'): OperationExecutionRequest {
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

for (const operation of ['copy', 'move'] as const) {
  for (const strategy of ['force', 'skip'] as const) {
    test(`${operation} ${strategy} executes once with quoted paths and no preflight`, async () => {
      const remote = mockClient((_command, _index, channel) => {
        channel.onEnd = (current) => current.complete()
      })
      attachSession(remote.client)
      try {
        const source = "/home/space ' quote\n中文; $(touch nope)"
        const result = await executeRemoteOperation({ ...copyRequest(strategy), operation, sourcePaths: [source] })
        assert.equal(result.status, 'completed')
        assert.equal(remote.commands.length, 1)
        assert.ok(remote.commands[0].includes(shellQuote(source)))
        const utility = operation === 'copy' ? 'cp -R --preserve=mode,timestamps' : 'mv'
        assert.ok(remote.commands[0].includes(`${utility} -${strategy === 'force' ? 'f' : 'n'} -- "$@"`))
        assert.ok(!remote.commands[0].includes('find --'))
        assert.ok(!remote.commands[0].includes('mktemp'))
      } finally { sessions.delete('session-1') }
    })
  }
}

for (const [archive, options] of [
  ['release.tar.gz', ['--overwrite', '--skip-old-files', '--keep-newer-files']],
  ['release.zip', ['-o', '-n', '-u']],
] as const) {
  for (const [index, strategy] of (['force', 'skip', 'update'] as const).entries()) {
    test(`extracts ${archive} with ${strategy} directly without scanning`, async () => {
      const remote = mockClient((_command, _index, channel) => {
        channel.onEnd = (current) => current.complete()
      })
      attachSession(remote.client)
      try {
        const result = await executeRemoteOperation({
          ...copyRequest(), operation: 'extract', sourcePaths: [],
          archivePath: '/home/' + archive, wrapInDirectory: true, strategy,
        })
        assert.equal(result.status, 'completed')
        assert.equal(remote.commands.length, 1)
        assert.ok(remote.commands[0].includes('mkdir -p -- "$output"'))
        assert.ok(remote.commands[0].includes(options[index]))
        assert.ok(remote.commands[0].includes(shellQuote('/home/target/release')))
        assert.ok(!remote.commands[0].includes('find --'))
        assert.ok(!remote.commands[0].includes('mktemp'))
      } finally { sessions.delete('session-1') }
    })
  }
}

test('rejects invalid requests before opening an SSH channel', () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    for (const targetDirectory of ['/home/source', '/home/source/nested']) {
      assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/home/source'], targetDirectory }), /自身或其子文件夹/)
    }
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/'] }), /来源路径无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/a', '/a'] }), /来源路径无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), strategy: 'confirm' } as unknown as OperationExecutionRequest), /参数无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), strategy: 'update' }), /仅支持覆盖或跳过/)
    assert.equal(remote.commands.length, 0)
  } finally { sessions.delete('session-1') }
})

for (const [operation, error] of [
  ['move', 'mv: cannot move: Directory not empty'],
  ['extract', 'unzip: command not found'],
] as const) {
  test(`propagates server ${operation} errors without retries`, async () => {
    const remote = mockClient((_command, _index, channel) => {
      channel.onEnd = (current) => {
        current.stderr.emit('data', Buffer.from(error))
        current.complete(Buffer.alloc(0), 1)
      }
    })
    attachSession(remote.client)
    try {
      await assert.rejects(executeRemoteOperation({ ...copyRequest(), operation,
        ...(operation === 'extract' ? { sourcePaths: [], archivePath: '/home/a.zip', wrapInDirectory: false } : {}),
      }), { message: error })
      assert.equal(remote.commands.length, 1)
    } finally { sessions.delete('session-1') }
  })
}

test('rejects duplicate request IDs and cancels the active command through SSH', async () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    const pending = executeRemoteOperation(copyRequest())
    assert.throws(() => executeRemoteOperation(copyRequest()), /编号重复/)
    assert.equal(remote.commands.length, 1)
    assert.equal(cancelRemoteOperation('request-1'), true)
    assert.equal((await pending).status, 'cancelled')
    assert.deepEqual(remote.channels[0].signals, ['TERM'])
    assert.equal(cancelRemoteOperation('request-1'), false)
  } finally { sessions.delete('session-1') }
})
