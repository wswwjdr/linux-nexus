import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { transferFileStream } from '../src/main/transfers/stream-transfer.ts'

class MockChannel extends EventEmitter {
  stderr = new EventEmitter()
  input: Buffer[] = []
  onEnd?: (channel: MockChannel) => void

  write(chunk: Buffer): boolean {
    this.input.push(Buffer.from(chunk))
    return true
  }

  end(): void {
    this.onEnd?.(this)
  }

  pause(): void {}
  resume(): void {}

  complete(stdout = Buffer.alloc(0)): void {
    if (stdout.length) this.emit('data', stdout)
    this.emit('exit', 0)
    this.emit('close', 0)
  }

  signal(): void {}
  close(): void { this.emit('close', 143) }
  destroy(): void { this.close() }
}

function clientFor(prepare: (command: string, channel: MockChannel) => void): Client {
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new MockChannel()
    prepare(command, channel)
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  return client
}

test('uploads bytes through SSH stdin to a temporary file before the selected mv policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linux-nexus-upload-'))
  const sourcePath = join(directory, 'local file.txt')
  const payload = Buffer.from('上传内容\n')
  await writeFile(sourcePath, payload)
  const attributes = await stat(sourcePath)
  let command = ''
  let channel: MockChannel | undefined
  const client = clientFor((remoteCommand, current) => {
    command = remoteCommand
    channel = current
    current.onEnd = (completed) => completed.complete()
  })
  const progress: number[] = []

  try {
    await transferFileStream('upload', client, sourcePath, '/home/remote file.txt', payload.length,
      new AbortController().signal, (bytes) => progress.push(bytes), {
        strategy: 'skip',
        modifiedAtMs: attributes.mtimeMs,
      })
    assert.ok(command.includes('mktemp --'))
    assert.ok(command.includes('cat > "$temporary"'))
    assert.ok(command.includes('mv -nT -- "$temporary" "$destination"'))
    assert.deepEqual(Buffer.concat(channel!.input), payload)
    assert.equal(progress.reduce((sum, value) => sum + value, 0), payload.length)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('downloads an SSH stdout stream into a local temporary file and atomically renames it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linux-nexus-download-'))
  const destination = join(directory, 'download.txt')
  const payload = Buffer.from('remote bytes\n')
  let command = ''
  const client = clientFor((remoteCommand, channel) => {
    command = remoteCommand
    channel.onEnd = (completed) => completed.complete(payload)
  })
  const progress: number[] = []

  try {
    await transferFileStream('download', client, '/home/remote.txt', destination, payload.length,
      new AbortController().signal, (bytes) => progress.push(bytes))
    assert.ok(command.includes('dd if="$1" iflag=skip_bytes,count_bytes'))
    assert.deepEqual(await readFile(destination), payload)
    assert.equal(progress.reduce((sum, value) => sum + value, 0), payload.length)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
