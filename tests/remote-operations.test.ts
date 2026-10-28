import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { buildRemoteOperationCommand, cancelRemoteOperation, executeRemoteOperation, preflightRemoteOperation } from '../src/main/remote-operations.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'
import type { OperationPreflight, OperationPreflightRequest } from '../src/shared/types.ts'

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

function copyPreflight(strategy: OperationPreflightRequest['strategy'] = 'confirm'): OperationPreflightRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    operation: 'copy',
    sourcePaths: ['/home/space name', '/home/中文\n文件'],
    targetDirectory: '/home/target',
    strategy,
  }
}

function attachSession(client: Client): string {
  const sessionId = 'session-1'
  sessions.set(sessionId, { sessionId, client, kind: 'files', profileId: 'profile-1' })
  return sessionId
}

function preflightBase(operation: 'copy' | 'move'): Pick<OperationPreflight, 'operation' | 'sourcePaths' | 'targetDirectory'> {
  return { operation, sourcePaths: ['/home/source'], targetDirectory: '/home/destination' }
}

test('builds cp and mv commands with native policy flags and quoted paths', () => {
  const source = "/home/space ' quote\n中文"
  const base = { ...preflightBase('copy'), sourcePaths: [source] }
  const force = buildRemoteOperationCommand(base, 'force')
  const skip = buildRemoteOperationCommand(base, 'skip')
  const update = buildRemoteOperationCommand(base, 'update')

  assert.ok(force.includes('cp -R --preserve=mode,timestamps -f -- "$@"'))
  assert.ok(skip.includes('cp -R --preserve=mode,timestamps -n -- "$@"'))
  assert.ok(update.includes('cp -R --preserve=mode,timestamps -u -- "$@"'))
  assert.ok(force.includes(shellQuote(source)))

  assert.ok(buildRemoteOperationCommand(preflightBase('move'), 'force').includes('mv -f -- "$@"'))
  assert.ok(buildRemoteOperationCommand(preflightBase('move'), 'skip').includes('mv -n -- "$@"'))
  assert.ok(buildRemoteOperationCommand(preflightBase('move'), 'update').includes('mv -u -- "$@"'))
})

test('builds extraction commands using only native archive tools in private staging', () => {
  const command = buildRemoteOperationCommand({
    operation: 'extract',
    sourcePaths: [],
    targetDirectory: '/home/target',
    archivePath: '/home/release.tar.gz',
    outputDirectory: '/home/target/release',
  }, 'skip')

  assert.ok(command.includes('tar --no-same-owner --no-same-permissions -xzf'))
  assert.ok(command.includes('mktemp -d'))
  assert.ok(command.includes('cp -R -n'))
  assert.ok(command.includes('chmod -R u+rwX,go-rwx -- "$payload"'))
  assert.ok(command.includes('unsupported=$(find -- "$payload"'))
  assert.ok(command.includes('find -- "$payload" -mindepth 1 -print0 > "$members"'))
  assert.ok(command.includes('find -- "$payload"'))
  assert.ok(!command.includes('python'))
})

test('preflight reports server conflicts without running the final copy command', async () => {
  const conflictOutput = Buffer.from([
    '/home/source', '/home/target/source', 'file', 'file', '',
  ].join('\0'))
  const remote = mockClient((_command, index, channel) => {
    channel.onEnd = (current) => current.complete(index === 0 ? conflictOutput : Buffer.alloc(0))
  })
  attachSession(remote.client)
  try {
    const preflight = await preflightRemoteOperation(copyPreflight())
    assert.equal(remote.commands.length, 1)
    assert.equal(preflight.conflicts.length, 1)
    assert.ok(remote.commands[0].includes('find --'))
    assert.ok(remote.commands[0].includes('unsupported=$(find -- "$source"'))
    assert.ok(remote.commands[0].includes('find -- "$source" -print0 > "$members"'))
    assert.ok(!remote.commands[0].includes('< <(find'))
    assert.ok(!remote.commands[0].includes('cp -R'))

    const result = await executeRemoteOperation({ preflightId: preflight.preflightId, strategy: 'skip' })
    assert.equal(result.status, 'completed')
    assert.equal(remote.commands.length, 2)
    assert.ok(remote.commands[1].includes('cp -R --preserve=mode,timestamps -n -- "$@"'))
  } finally {
    sessions.delete('session-1')
  }
})

test('archive preflight stages the archive and reports conflicts for nested members', async () => {
  const output = Buffer.from([
    'C', '/home/release.zip!/nested/readme.txt', '/home/target/nested/readme.txt', 'file', 'file', '',
  ].join('\0'))
  const remote = mockClient((_command, _index, channel) => {
    channel.onEnd = (current) => current.complete(output)
  })
  attachSession(remote.client)
  try {
    const preflight = await preflightRemoteOperation({
      requestId: 'archive-preflight',
      sessionId: 'session-1',
      operation: 'extract',
      sourcePaths: [],
      targetDirectory: '/home/target',
      archivePath: '/home/release.zip',
      wrapInDirectory: false,
      strategy: 'confirm',
    })
    assert.deepEqual(preflight.conflicts, [{
      sourcePath: '/home/release.zip!/nested/readme.txt',
      targetPath: '/home/target/nested/readme.txt',
      sourceType: 'file',
      targetType: 'file',
    }])
    assert.ok(remote.commands[0].includes('unzip -qq'))
    assert.ok(remote.commands[0].includes('mktemp -d'))
    assert.ok(remote.commands[0].includes('chmod -R u+rwX,go-rwx -- "$payload"'))
    assert.ok(remote.commands[0].includes('find -- "$payload" -mindepth 1 -print0 > "$members"'))
    assert.ok(!remote.commands[0].includes('< <(find'))
    assert.ok(remote.commands[0].includes('find -- "$payload"'))
  } finally {
    sessions.delete('session-1')
  }
})

test('cancels a final server command by sending TERM through the active channel', async () => {
  const remote = mockClient((_command, index, channel) => {
    if (index === 0) channel.onEnd = (current) => current.complete()
  })
  attachSession(remote.client)
  try {
    const preflight = await preflightRemoteOperation({ ...copyPreflight(), strategy: 'force' })
    const pending = executeRemoteOperation({ preflightId: preflight.preflightId, strategy: 'force' })
    assert.equal(cancelRemoteOperation(preflight.preflightId), true)
    const result = await pending
    assert.equal(result.status, 'cancelled')
    assert.deepEqual(remote.channels[1].signals, ['TERM'])
  } finally {
    sessions.delete('session-1')
  }
})
