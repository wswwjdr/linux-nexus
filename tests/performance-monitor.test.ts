import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { PerformanceUpdate } from '../src/shared/types.ts'
import { refreshPerformanceMonitor, startPerformanceMonitor, stopAllPerformanceMonitors, stopPerformanceMonitor } from '../src/main/performance-monitor.ts'
import { getMainWindow, sessions, setMainWindow, type ActiveSession } from '../src/main/runtime.ts'

const report = [
  'cpu 100 0 50 800 0 0 0 0',
  'mem 1000000 250000',
  'load 0.10 0.20 0.30',
  'uptime 12345.6',
  'cores 4',
  'disk 1000000000 250000000 750000000 25%',
].join('\n')

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter()
  closed = false

  close(): void {
    this.closed = true
    queueMicrotask(() => {
      this.emit('exit', 255)
      this.emit('close')
    })
  }
}

class FakeClient extends EventEmitter {
  readonly commands: string[] = []

  exec(command: string, callback: (error: Error | undefined, channel: ClientChannel) => void): void {
    this.commands.push(command)
    const channel = new FakeChannel()
    callback(undefined, channel as unknown as ClientChannel)
    setImmediate(() => {
      if (channel.closed) return
      channel.emit('data', Buffer.from(report))
      channel.emit('exit', 0)
      channel.emit('close')
    })
  }
}

function waitForUpdate(updates: PerformanceUpdate[], monitorId: string, status: PerformanceUpdate['status'], startIndex = 0, timeoutMs = 1_000): Promise<PerformanceUpdate> {
  const existing = updates.slice(startIndex).find((update) => update.monitorId === monitorId && update.status === status)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    let interval: NodeJS.Timeout
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error('Timed out waiting for performance update'))
    }, timeoutMs)
    interval = setInterval(() => {
      const update = updates.slice(startIndex).find((candidate) => candidate.monitorId === monitorId && candidate.status === status)
      if (!update) return
      clearTimeout(timeout)
      clearInterval(interval)
      resolve(update)
    }, 1)
  })
}

test('starts a fresh monitor per active session and ignores stale stops and results', async (t) => {
  const updates: PerformanceUpdate[] = []
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (_channel: string, update: PerformanceUpdate) => updates.push(update) },
  } as unknown as BrowserWindow
  const client = new FakeClient()
  const session = {
    sessionId: 'session-1',
    profileId: 'profile-1',
    kind: 'sftp',
    client,
  } as unknown as ActiveSession
  sessions.set(session.sessionId, session)
  setMainWindow(fakeWindow)
  t.after(() => {
    stopAllPerformanceMonitors()
    sessions.clear()
    setMainWindow(null)
  })

  startPerformanceMonitor(session.sessionId, 'monitor-old')
  stopPerformanceMonitor(session.sessionId, 'monitor-old')
  startPerformanceMonitor(session.sessionId, 'monitor-current')

  const first = await waitForUpdate(updates, 'monitor-current', 'ready')
  assert.equal(first.snapshot?.cpuPercent, null)
  assert.equal(client.commands.length, 2)
  assert.match(client.commands[1], /\/proc\/stat/)
  assert.equal(getMainWindow(), fakeWindow)
  assert.equal(updates.some((update) => update.monitorId === 'monitor-old' && update.status === 'ready'), false)

  stopPerformanceMonitor(session.sessionId, 'monitor-old')
  assert.doesNotThrow(() => refreshPerformanceMonitor(session.sessionId, 'monitor-current'))
  await waitForUpdate(updates, 'monitor-current', 'ready', updates.indexOf(first) + 1)
  assert.equal(client.commands.length, 3)

  await waitForUpdate(updates, 'monitor-current', 'ready', updates.length, 6_500)
  assert.equal(client.commands.length, 4)

  stopPerformanceMonitor(session.sessionId, 'monitor-current')
  assert.throws(() => refreshPerformanceMonitor(session.sessionId, 'monitor-current'))
})
