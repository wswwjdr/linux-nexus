import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate as settle } from 'node:timers/promises'
import test, { type TestContext } from 'node:test'
import type { BrowserWindow } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { PerformanceMonitorState } from '../src/shared/types.ts'
import {
  configurePerformanceMonitorInterval, focusPerformanceMonitor, getPerformanceMonitorState, refreshPerformanceMonitor,
  removePerformanceMonitorForSession, setPerformanceMonitorEnabled, stopAllPerformanceMonitors,
} from '../src/main/performance-monitor.ts'
import { MOUNT_CAPACITY_COMMAND, PERFORMANCE_COMMAND } from '../src/main/performance-sampling.ts'
import { sessions, setMainWindow, type ActiveSession } from '../src/main/runtime.ts'
import { buildRemoteCommand } from '../src/main/ssh-commands.ts'
import { mountFixture, performanceFixture } from './helpers/performance-fixture.ts'

class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter()
  cancelled = false

  /** Leaves stdout open, matching the outgoing stdin half-close. */
  end(): void {}

  /** Records a cancellation without settling, so the test can send a late reply. */
  signal(): void { this.cancelled = true }

  /** Finishes the SSH channel with no exit status. */
  close(): void { this.emit('close') }

  /** Sends output and closes the channel with an exit status. */
  complete(output: string, code = 0): void {
    if (output) this.emit('data', Buffer.from(output))
    this.emit('exit', code)
    this.close()
  }
}

class FakeClient extends EventEmitter {
  readonly kernel: FakeChannel[] = []
  readonly mounts: FakeChannel[] = []

  /** Attaches an idle channel to the requested sampler for controlled completion in tests. */
  exec(command: string, attach: (error: undefined, channel: ClientChannel) => void): void {
    const channel = new FakeChannel()
    assert.ok(command === buildRemoteCommand(PERFORMANCE_COMMAND) || command === buildRemoteCommand(MOUNT_CAPACITY_COMMAND))
    const requests = command === buildRemoteCommand(MOUNT_CAPACITY_COMMAND) ? this.mounts : this.kernel
    requests.push(channel)
    attach(undefined, channel as unknown as ClientChannel)
  }
}

/** Installs a fake connected SSH session and returns its client. */
function connect(sessionId: string): FakeClient {
  const client = new FakeClient()
  sessions.set(sessionId, { sessionId, client, profileId: sessionId, kind: 'files' } as unknown as ActiveSession)
  return client
}

/** Configures deterministic timers and returns the emitted monitor events for assertions. */
function setup(t: TestContext): PerformanceMonitorState[] {
  const updates: PerformanceMonitorState[] = []
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10_000 })
  setMainWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (_channel: string, update: PerformanceMonitorState) => updates.push(update),
    },
  } as unknown as BrowserWindow)
  t.after(async () => {
    stopAllPerformanceMonitors()
    t.mock.timers.tick(2_000)
    await settle()
    setMainWindow(null)
    sessions.clear()
    configurePerformanceMonitorInterval(3)
  })
  return updates
}

test('starts only when enabled and quickly switches tabs without overlapping or applying stale replies', async (t) => {
  const updates = setup(t)
  const a = connect('a')
  const b = connect('b')
  const initial = focusPerformanceMonitor('a')
  assert.equal(initial.enabled, false)
  refreshPerformanceMonitor('a')
  t.mock.timers.tick(5_000)
  assert.equal(a.kernel.length + a.mounts.length, 0)
  assert.equal(setPerformanceMonitorEnabled('b', true).sessionId, 'a')

  assert.equal(setPerformanceMonitorEnabled('a', true).enabled, true)
  refreshPerformanceMonitor('a')
  assert.equal(a.kernel.length, 1)
  assert.equal(a.mounts.length, 1)
  focusPerformanceMonitor('b')
  assert.equal(a.kernel[0].cancelled, true)
  assert.equal(a.mounts[0].cancelled, true)
  setPerformanceMonitorEnabled('b', true)
  focusPerformanceMonitor('a')
  assert.equal(b.kernel.length + b.mounts.length, 0)
  a.kernel[0].complete(performanceFixture({ at: 500 }))
  a.mounts[0].complete(mountFixture)
  await settle()
  assert.deepEqual(getPerformanceMonitorState().metrics, {})
  assert.equal(a.kernel.length, 2)
  assert.equal(a.mounts.length, 2)
  a.kernel[1].complete(performanceFixture({ at: 100 }))
  a.mounts[1].complete(mountFixture)
  await settle()
  const resumed = getPerformanceMonitorState()
  assert.equal(resumed.metrics.uptime?.latest?.value, 100)
  assert.equal(resumed.metrics.cpu?.latest?.value.percent, null)

  refreshPerformanceMonitor('a')
  a.kernel[2].complete(performanceFixture({ at: 103, step: 1 }))
  await settle()
  assert.equal(getPerformanceMonitorState().metrics.cpu?.latest?.value.percent, 12.5)
  setPerformanceMonitorEnabled('a', false)
  assert.equal(a.mounts[2].cancelled, true)
  assert.deepEqual(getPerformanceMonitorState().metrics, {})
  focusPerformanceMonitor('b')
  assert.equal(getPerformanceMonitorState().enabled, true)
  removePerformanceMonitorForSession('b')
  connect('b')
  assert.equal(focusPerformanceMonitor('b').enabled, false)
  assert.ok(updates.every((state, index) => index === 0 || state.version > updates[index - 1].version))
})

test('capacity timeout is isolated, intervals are rescheduled, and stale capacity is marked on failure', async (t) => {
  setup(t)
  const client = connect('host')
  focusPerformanceMonitor('host')
  configurePerformanceMonitorInterval(1)
  setPerformanceMonitorEnabled('host', true)
  client.kernel[0].complete(performanceFixture())
  await settle()
  assert.ok(getPerformanceMonitorState().metrics.memory?.latest)
  assert.equal(getPerformanceMonitorState().metrics.mounts, undefined)

  configurePerformanceMonitorInterval(2)
  t.mock.timers.tick(1_999)
  assert.equal(client.kernel.length, 1)
  t.mock.timers.tick(1)
  client.kernel[1].complete(performanceFixture({ at: 102, step: 1 }))
  await settle()
  assert.equal(getPerformanceMonitorState().metrics.cpu?.latest?.value.percent, 12.5)
  t.mock.timers.tick(2_500)
  assert.equal(client.mounts[0].cancelled, true)
  client.mounts[0].close()
  client.kernel[2].complete(performanceFixture({ at: 104, step: 2, failedSource: 'network' }))
  await settle()
  assert.ok(getPerformanceMonitorState().metrics.mounts?.error)
  assert.ok(getPerformanceMonitorState().metrics.network?.error)
  assert.equal(getPerformanceMonitorState().metrics.cpu?.error, null)
  assert.equal(client.mounts.length, 1)

  refreshPerformanceMonitor('host')
  refreshPerformanceMonitor('host')
  assert.equal(client.mounts.length, 2)
  assert.equal(client.kernel.length, 4)
  client.mounts[1].complete(mountFixture)
  client.kernel[3].complete(performanceFixture({ at: 106, step: 3 }))
  await settle()
  assert.equal(getPerformanceMonitorState().metrics.mounts?.latest?.value[0].target, '/')
  assert.equal(getPerformanceMonitorState().metrics.network?.latest?.value[0].receiveBytesPerSecond, null)

  refreshPerformanceMonitor('host')
  client.mounts[2].complete('', 1)
  await settle()
  assert.ok(getPerformanceMonitorState().metrics.mounts?.error)
  assert.equal(getPerformanceMonitorState().metrics.mounts?.latest?.value[0].target, '/')
})
