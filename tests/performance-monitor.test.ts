import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { PerformanceMonitorState } from '../src/shared/types.ts'
import {
  activatePerformanceMonitor,
  configurePerformanceMonitorInterval,
  deactivatePerformanceMonitor,
  getPerformanceMonitorState,
  refreshPerformanceMonitor,
  removePerformanceMonitorForSession,
  stopAllPerformanceMonitors,
} from '../src/main/performance-monitor.ts'
import { sessions, setMainWindow, type ActiveSession } from '../src/main/runtime.ts'

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
    if (this.closed) return
    this.closed = true
    queueMicrotask(() => {
      this.emit('exit', 255)
      this.emit('close')
    })
  }
}

class FakeClient extends EventEmitter {
  readonly commands: string[] = []
  nextFailures = 0
  activeCommands = 0
  maxConcurrentCommands = 0

  exec(command: string, callback: (error: Error | undefined, channel: ClientChannel) => void): void {
    this.commands.push(command)
    const channel = new FakeChannel()
    const shouldFail = this.nextFailures > 0
    if (shouldFail) this.nextFailures -= 1
    this.activeCommands += 1
    this.maxConcurrentCommands = Math.max(this.maxConcurrentCommands, this.activeCommands)
    channel.once('close', () => { this.activeCommands -= 1 })
    callback(undefined, channel as unknown as ClientChannel)
    setTimeout(() => {
      if (channel.closed) return
      if (shouldFail) {
        channel.stderr.emit('data', Buffer.from('sample failed'))
        channel.emit('exit', 1)
      } else {
        const sampleNumber = this.commands.length
        const currentReport = report.replace(
          'cpu 100 0 50 800 0 0 0 0',
          `cpu ${100 + sampleNumber * 10} 0 ${50 + sampleNumber * 5} ${800 + sampleNumber * 15} 0 0 0 0`,
        )
        channel.emit('data', Buffer.from(currentReport))
        channel.emit('exit', 0)
      }
      channel.emit('close')
    }, 10)
  }
}

function waitForState(
  sessionId: string,
  predicate: (state: PerformanceMonitorState) => boolean,
  timeoutMs = 2_000,
): Promise<PerformanceMonitorState> {
  const current = getPerformanceMonitorState(sessionId)
  if (predicate(current)) return Promise.resolve(current)
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const state = getPerformanceMonitorState(sessionId)
      if (!predicate(state)) return
      clearInterval(interval)
      clearTimeout(timeout)
      resolve(state)
    }, 5)
    const timeout = setTimeout(() => {
      clearInterval(interval)
      reject(new Error('Timed out waiting for performance monitor state'))
    }, timeoutMs)
  })
}

test('suspends by session, preserves segmented history, and clears it when the session closes', async (t) => {
  const updates: PerformanceMonitorState[] = []
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (_channel: string, update: PerformanceMonitorState) => updates.push(update) },
  } as unknown as BrowserWindow
  const client = new FakeClient()
  const session = {
    sessionId: 'session-1',
    profileId: 'profile-1',
    kind: 'files',
    client,
  } as unknown as ActiveSession
  sessions.set(session.sessionId, session)
  setMainWindow(fakeWindow)
  configurePerformanceMonitorInterval(1)
  t.after(() => {
    stopAllPerformanceMonitors()
    sessions.clear()
    setMainWindow(null)
    configurePerformanceMonitorInterval(3)
  })

  const activated = activatePerformanceMonitor(session.sessionId)
  assert.equal(activated.status, 'sampling')
  const firstSample = await waitForState(session.sessionId, (state) => state.status === 'ready' && state.history[0]?.length === 1)
  assert.equal(firstSample.snapshot?.cpuPercent, null)

  const secondSample = await waitForState(session.sessionId, (state) => state.history[0]?.length >= 2)
  assert.equal(typeof secondSample.history[0][1].cpuPercent, 'number')
  assert.equal(client.maxConcurrentCommands, 1)

  const commandCountBeforeIntervalChange = client.commands.length
  configurePerformanceMonitorInterval(2)
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  assert.equal(client.commands.length, commandCountBeforeIntervalChange)
  await waitForState(session.sessionId, (state) => state.history[0]?.length >= 3, 1_500)
  configurePerformanceMonitorInterval(1)

  const commandCountBeforePause = client.commands.length
  deactivatePerformanceMonitor(session.sessionId)
  assert.equal(getPerformanceMonitorState(session.sessionId).status, 'inactive')
  await new Promise((resolve) => setTimeout(resolve, 1_100))
  assert.equal(client.commands.length, commandCountBeforePause)
  assert.equal(getPerformanceMonitorState(session.sessionId).history.length, 1)

  activatePerformanceMonitor(session.sessionId)
  const resumedFirstSample = await waitForState(session.sessionId, (state) => state.history.length === 2 && state.history[1]?.length === 1)
  assert.equal(resumedFirstSample.history[1][0].cpuPercent, null)
  const resumedSecondSample = await waitForState(session.sessionId, (state) => state.history[1]?.length >= 2)
  assert.equal(typeof resumedSecondSample.history[1][1].cpuPercent, 'number')
  assert.equal(updates.some((state) => state.version > resumedSecondSample.version), false)

  client.nextFailures = 1
  refreshPerformanceMonitor(session.sessionId)
  const failed = await waitForState(session.sessionId, (state) => state.status === 'error')
  assert.match(failed.message ?? '', /sample failed/)
  const recovered = await waitForState(session.sessionId, (state) => state.status === 'ready' && state.history.length === 3)
  assert.equal(recovered.history[2][0].cpuPercent, null)
  assert.equal(client.maxConcurrentCommands, 1)

  deactivatePerformanceMonitor(session.sessionId)
  removePerformanceMonitorForSession(session.sessionId)
  const cleared = getPerformanceMonitorState(session.sessionId)
  assert.equal(cleared.status, 'inactive')
  assert.deepEqual(cleared.history, [])

  activatePerformanceMonitor(session.sessionId)
  await waitForState(session.sessionId, (state) => state.history[0]?.length === 1)
  stopAllPerformanceMonitors()
  assert.deepEqual(getPerformanceMonitorState(session.sessionId).history, [])
  for (let index = 1; index < updates.length; index += 1) {
    assert.ok(updates[index].version > updates[index - 1].version)
  }
})
