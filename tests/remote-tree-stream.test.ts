import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { iterateRemoteTree } from '../src/main/remote-fs.ts'

test('streams a 100000-file tree with backpressure and bounded retained memory', async () => {
  const start = performance.now(), baseline = process.memoryUsage().heapUsed
  const client = new EventEmitter() as Client
  class Channel extends Readable {
    stderr = new EventEmitter()
    index = 0
    _read() {
      while (this.index < 100000) {
        const index = this.index++
        if (!this.push(Buffer.from([`file-${index}`, 'f', '10', ''].join('\0')))) return
      }
      this.push(null)
    }
    end() {}
    signal() { this.destroy() }
    close() { this.destroy() }
  }
  client.exec = (_command: string, callback: (error: undefined, channel: ClientChannel) => void) => {
    const channel = new Channel({ highWaterMark: 16384 })
    channel.on('end', () => { channel.emit('exit', 0); channel.emit('close', 0) })
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  let count = 0, peak = baseline
  for await (const item of iterateRemoteTree(client, '/tree')) {
    assert.equal(item.type, 'file')
    assert.equal(item.size, 10)
    count++
    if (count % 1000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed)
  }
  assert.equal(count, 100000)
  assert.ok(peak - baseline < 128 * 1024 * 1024)
  console.log(JSON.stringify({ treeFiles: count, elapsedMs: Math.round(performance.now() - start), peakHeapGrowthMiB: Math.round((peak - baseline) / 1024 / 1024) }))
})
