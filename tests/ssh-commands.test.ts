import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { buildRemoteCommand, executeRemoteCommand, RemoteCommandError, cancelClientTasks, runRemoteCommand } from '../src/main/ssh-commands.ts'
import { shellQuote } from '../src/shared/shell.ts'

class MockChannel extends EventEmitter {
  stderr = new EventEmitter()
  input: Buffer[] = []
  signals: string[] = []
  destroyed = false
  private writes = 0
  onEnd?: (channel: MockChannel) => void

  write(value: Buffer): boolean {
    this.input.push(Buffer.from(value))
    this.writes += 1
    if (this.writes === 1 && this.backpressure) {
      queueMicrotask(() => this.emit('drain'))
      return false
    }
    return true
  }

  constructor(private readonly backpressure = false) {
    super()
  }

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
    this.destroyed = true
    queueMicrotask(() => {
      this.emit('exit', 143)
      this.emit('close', 143)
    })
  }

  destroy(): void {
    this.close()
  }

  complete(stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), exitCode = 0): void {
    if (stdout.length) this.emit('data', stdout)
    if (stderr.length) this.stderr.emit('data', stderr)
    this.emit('exit', exitCode)
    this.emit('close', exitCode)
  }
}

function mockClient(createChannel: (command: string) => MockChannel): Client {
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    callback(undefined, createChannel(command) as unknown as ClientChannel)
    return client
  }
  return client
}

test('builds SSH command arguments without losing spaces, quotes, newlines or Unicode', () => {
  const values = ["space name", "single'quote", 'line\nbreak', '中文目录']
  const command = buildRemoteCommand('printf "%s\\n" "$@"', values)

  assert.ok(command.startsWith("bash -c '"))
  for (const value of values) assert.ok(command.includes(shellQuote(value)))
  assert.throws(() => buildRemoteCommand('true', ['bad\0argument']), /NUL/)
})

test('streams stdin with backpressure and collects stdout through one SSH exec channel', async () => {
  let channel: MockChannel | undefined
  const client = mockClient(() => {
    channel = new MockChannel(true)
    channel.onEnd = (current) => current.complete(Buffer.from('server result'))
    return channel
  })
  const sent: number[] = []
  const result = await runRemoteCommand(client, 'cat', ['/tmp/远端'], {
    stdin: [Buffer.from('first'), Buffer.from('second')],
    onStdin: (chunk) => sent.push(chunk.length),
  })

  assert.equal(result.stdout.toString(), 'server result')
  assert.equal(Buffer.concat(channel!.input).toString(), 'firstsecond')
  assert.deepEqual(sent, [5, 6])
})

test('does not collect streamed stdout into a return buffer', async () => {
  const client = mockClient(() => {
    const channel = new MockChannel()
    channel.onEnd = (current) => current.complete(Buffer.alloc(1024 * 1024, 7))
    return channel
  })
  const result = await runRemoteCommand(client, 'dd', [], { collectStdout: false })
  assert.equal(result.stdout.length, 0)
})

test('preserves server stderr exactly when a command fails', async () => {
  const client = mockClient(() => {
    const channel = new MockChannel()
    channel.onEnd = (current) => current.complete(Buffer.alloc(0), Buffer.from('permission denied\nraw'), 1)
    return channel
  })

  await assert.rejects(runRemoteCommand(client, 'rm', ['/protected']), (error: unknown) => {
    assert.ok(error instanceof RemoteCommandError)
    assert.equal(error.exitCode, 1)
    assert.equal(error.stderr, 'permission denied\nraw')
    assert.equal(error.message, error.stderr)
    return true
  })
})

test('sends TERM and settles when an SSH command is cancelled', async () => {
  let channel: MockChannel | undefined
  const client = mockClient(() => {
    channel = new MockChannel()
    return channel
  })
  const controller = new AbortController()
  const pending = executeRemoteCommand(client, 'sleep 60', { signal: controller.signal })
  controller.abort()

  await assert.rejects(pending, /已取消/)
  assert.deepEqual(channel?.signals, ['TERM'])
  assert.equal(channel?.destroyed, false)
})

test('terminates a command when its timeout expires', async () => {
  let channel: MockChannel | undefined
  const client = mockClient(() => {
    channel = new MockChannel()
    return channel
  })

  await assert.rejects(executeRemoteCommand(client, 'sleep 60', { timeoutMs: 5 }), /超时/)
  assert.deepEqual(channel?.signals, ['TERM'])
})


test('timeouts before channel open settle and destroy a late channel without starting stdin', async () => {
  const client = new EventEmitter() as Client & EventEmitter
  let callback!: (error: undefined, channel: ClientChannel) => void
  client.exec = (_command: string, next: typeof callback) => { callback = next; return client }
  await assert.rejects(executeRemoteCommand(client, 'true', { timeoutMs: 5 }), /超时.*远端状态未知/)
  const channel = new MockChannel()
  callback(undefined, channel as unknown as ClientChannel)
  assert.equal(channel.destroyed, true)
  assert.equal(client.listenerCount('error'), 0)
})

test('bounds stderr and exposes truncation without changing the exit status', async () => {
  const client = mockClient(() => {
    const channel = new MockChannel()
    channel.onEnd = current => current.complete(Buffer.alloc(0), Buffer.alloc(1024, 65), 1)
    return channel
  })
  await assert.rejects(executeRemoteCommand(client, 'true', { maxStderrBytes: 16 }), error => {
    assert.ok(error instanceof RemoteCommandError)
    assert.equal(error.stderr, 'A'.repeat(16) + '\n[stderr 已截断]')
    return true
  })
})


test('sixteen concurrent commands share one connection observer and all fail on disconnect', async () => {
  const client = mockClient(() => new MockChannel())
  const commands = Array.from({ length: 16 }, () => executeRemoteCommand(client, 'sleep 1'))
  assert.equal(client.listenerCount('error'), 1)
  assert.equal(client.listenerCount('close'), 1)
  client.emit('close')
  const results = await Promise.allSettled(commands)
  assert.ok(results.every(result => result.status === 'rejected'))
  assert.equal(client.listenerCount('error'), 0)
})

test('cancellation without an exit acknowledgement reports unknown state and releases ownership', async () => {
  const client = mockClient(() => {
    const channel = new MockChannel()
    channel.signal = () => {}
    channel.close = () => {}
    return channel
  })
  const controller = new AbortController()
  const command = executeRemoteCommand(client, 'ignored TERM', { signal: controller.signal })
  controller.abort()
  await assert.rejects(command, /远端状态未知/)
  assert.equal(client.listenerCount('close'), 0)
})


test('connection shutdown waits for command acknowledgement before reporting idle', async () => {
  let channel!: MockChannel
  const client = mockClient(() => {
    channel = new MockChannel()
    channel.signal = () => {}
    return channel
  })
  const command = executeRemoteCommand(client, 'sleep 1').catch(error => error)
  let idle = false
  const shutdown = cancelClientTasks(client).then(() => { idle = true })
  await Promise.resolve()
  assert.equal(idle, false)
  channel.emit('exit', 143)
  channel.emit('close', 143)
  await shutdown
  assert.equal(idle, true)
  assert.match((await command).message, /命令通道已结束/)
})
