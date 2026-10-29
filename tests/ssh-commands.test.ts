import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { buildRemoteCommand, executeRemoteCommand, RemoteCommandError, runRemoteCommand } from '../src/main/ssh-commands.ts'
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
