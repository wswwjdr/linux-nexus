import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { setImmediate as settle } from 'node:timers/promises'
import test, { type TestContext } from 'node:test'
import type { BrowserWindow } from 'electron'
import type { ClientChannel } from 'ssh2'
import type { PerformanceMonitorState } from '../src/shared/types.ts'
import {
  configurePerformanceMonitorInterval, getPerformanceMonitorState, refreshPerformanceMonitor,
  registerPerformanceConnection, removePerformanceMonitor, setPerformanceMonitorEnabled, stopAllPerformanceMonitors,
  unregisterPerformanceConnection,
} from '../src/main/performance-monitor.ts'
import { MOUNT_CAPACITY_COMMAND, PERFORMANCE_COMMAND } from '../src/main/performance-sampling.ts'
import { setMainWindow, type ActiveSession } from '../src/main/runtime.ts'
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

/**
 * Registers a fake connected SSH session.
 * @param sessionId Tab ID, which can be reused after disconnection.
 * @param profileId Server configuration shared by related tabs.
 * @param kind File management or SSH terminal tab.
 * @returns The registered session and its controllable client.
 */
function connect(sessionId: string, profileId: string, kind: ActiveSession['kind'] = 'files') {
  const client = new FakeClient()
  const session: ActiveSession = { sessionId, profileId, kind, client: client as unknown as ActiveSession['client'] }
  registerPerformanceConnection(session)
  return { session, client }
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
    configurePerformanceMonitorInterval(3)
  })
  return updates
}

test('shares one sampler across three file tabs and a terminal while another server samples independently', async (t) => {
  const updates = setup(t)
  const { client: first } = connect('a-files-1', 'a')
  const extra = [connect('a-files-2', 'a'), connect('a-files-3', 'a'), connect('a-ssh', 'a', 'terminal')]
  const { client: other } = connect('b-files', 'b')
  assert.equal(getPerformanceMonitorState('a').enabled, false)
  refreshPerformanceMonitor('a')
  t.mock.timers.tick(5_000)
  assert.equal(first.kernel.length, 0)

  setPerformanceMonitorEnabled('a', true)
  setPerformanceMonitorEnabled('b', true)
  refreshPerformanceMonitor('a')
  refreshPerformanceMonitor('a')
  for (const client of [first, other]) {
    assert.equal(client.kernel.length, 1)
    assert.equal(client.mounts.length, 1)
  }
  first.kernel[0].complete(performanceFixture({ at: 100 }))
  other.kernel[0].complete(performanceFixture({ at: 500 }))
  first.mounts[0].complete(mountFixture)
  other.mounts[0].complete(mountFixture)
  await settle()

  const snapshot = getPerformanceMonitorState('a')
  unregisterPerformanceConnection(extra[2].session)
  assert.deepEqual(getPerformanceMonitorState('a'), snapshot)
  assert.equal(getPerformanceMonitorState('b').metrics.uptime?.latest?.value, 500)
  assert.equal(snapshot.metrics.uptime?.latest?.value, 100)

  t.mock.timers.tick(3_000)
  assert.equal(first.kernel.length, 2)
  assert.equal(other.kernel.length, 2)
  for (const { client } of extra) assert.equal(client.kernel.length + client.mounts.length, 0)

  setPerformanceMonitorEnabled('a', false)
  assert.equal(first.kernel[1].cancelled, true)
  assert.deepEqual(getPerformanceMonitorState('a').metrics, {})
  assert.equal(getPerformanceMonitorState('b').enabled, true)
  assert.equal(other.kernel[1].cancelled, false)
  assert.ok(updates.every((state, index) => index === 0 || state.version > updates[index - 1].version))
})

test('hands off the sampling connection and ignores its late replies without clearing published readings', async (t) => {
  setup(t)
  const first = connect('files', 'host')
  const next = connect('terminal', 'host', 'terminal')
  setPerformanceMonitorEnabled('host', true)
  first.client.kernel[0].complete(performanceFixture({ at: 100 }))
  first.client.mounts[0].complete(mountFixture)
  await settle()
  const { metrics } = getPerformanceMonitorState('host')

  refreshPerformanceMonitor('host')
  unregisterPerformanceConnection(first.session)
  assert.equal(first.client.kernel[1].cancelled, true)
  assert.equal(first.client.mounts[1].cancelled, true)
  assert.equal(next.client.kernel.length, 0)
  assert.deepEqual(getPerformanceMonitorState('host').metrics, metrics)
  first.client.kernel[1].complete(performanceFixture({ at: 900, step: 4 }))
  first.client.mounts[1].complete('', 1)
  await settle()

  assert.equal(next.client.kernel.length, 1)
  assert.equal(next.client.mounts.length, 1)
  assert.deepEqual(getPerformanceMonitorState('host').metrics, metrics)
  next.client.kernel[0].complete(performanceFixture({ at: 103, step: 1 }))
  next.client.mounts[0].complete(mountFixture)
  await settle()
  assert.equal(getPerformanceMonitorState('host').metrics.cpu?.latest?.value.percent, null)
  refreshPerformanceMonitor('host')
  next.client.kernel[1].complete(performanceFixture({ at: 106, step: 2 }))
  await settle()
  assert.equal(getPerformanceMonitorState('host').metrics.cpu?.latest?.value.percent, 12.5)
})

test('serializes rapid toggles and reconnects with a clean run while remembering the switch', async (t) => {
  setup(t)
  const first = connect('files', 'host')
  setPerformanceMonitorEnabled('host', true)
  setPerformanceMonitorEnabled('host', false)
  setPerformanceMonitorEnabled('host', true)
  refreshPerformanceMonitor('host')
  assert.equal(first.client.kernel.length, 1)
  assert.equal(first.client.kernel[0].cancelled, true)
  first.client.kernel[0].complete(performanceFixture({ at: 900 }))
  first.client.mounts[0].complete(mountFixture)
  await settle()
  assert.equal(first.client.kernel.length, 2)
  assert.deepEqual(getPerformanceMonitorState('host').metrics, {})
  first.client.kernel[1].complete(performanceFixture())
  await settle()

  unregisterPerformanceConnection(first.session)
  const offline = getPerformanceMonitorState('host')
  assert.equal(offline.connected, false)
  assert.equal(offline.enabled, true)
  assert.equal(offline.sampling, false)
  assert.deepEqual(offline.metrics, {})
  const next = connect('files', 'host')
  unregisterPerformanceConnection(first.session)
  assert.equal(getPerformanceMonitorState('host').connected, true)
  assert.equal(next.client.kernel.length, 1)
  assert.equal(next.client.mounts.length, 0)
  first.client.mounts[1].complete(mountFixture)
  await settle()
  assert.equal(next.client.mounts.length, 1)
  assert.deepEqual(getPerformanceMonitorState('host').metrics, {})

  unregisterPerformanceConnection(next.session)
  removePerformanceMonitor('host')
  const reconfigured = connect('files', 'host')
  assert.equal(getPerformanceMonitorState('host').enabled, false)
  assert.equal(reconfigured.client.kernel.length, 0)
  setPerformanceMonitorEnabled('host', true)
  stopAllPerformanceMonitors()
  assert.equal(reconfigured.client.kernel[0].cancelled, true)
  assert.equal(getPerformanceMonitorState('host').enabled, false)
})

test('capacity timeout is isolated, intervals are rescheduled, and stale capacity is marked on failure', async (t) => {
  setup(t)
  const { client } = connect('files', 'host')
  configurePerformanceMonitorInterval(1)
  setPerformanceMonitorEnabled('host', true)
  client.kernel[0].complete(performanceFixture())
  await settle()
  assert.ok(getPerformanceMonitorState('host').metrics.memory?.latest)
  assert.equal(getPerformanceMonitorState('host').metrics.mounts, undefined)

  configurePerformanceMonitorInterval(2)
  t.mock.timers.tick(1_999)
  assert.equal(client.kernel.length, 1)
  t.mock.timers.tick(1)
  client.kernel[1].complete(performanceFixture({ at: 102, step: 1 }))
  await settle()
  assert.equal(getPerformanceMonitorState('host').metrics.cpu?.latest?.value.percent, 12.5)
  t.mock.timers.tick(2_500)
  assert.equal(client.mounts[0].cancelled, true)
  client.mounts[0].close()
  client.kernel[2].complete(performanceFixture({ at: 104, step: 2, failedSource: 'network' }))
  await settle()
  assert.ok(getPerformanceMonitorState('host').metrics.mounts?.error)
  assert.ok(getPerformanceMonitorState('host').metrics.network?.error)
  assert.equal(getPerformanceMonitorState('host').metrics.cpu?.error, null)
  assert.equal(client.mounts.length, 1)

  refreshPerformanceMonitor('host')
  refreshPerformanceMonitor('host')
  assert.equal(client.mounts.length, 2)
  assert.equal(client.kernel.length, 4)
  client.mounts[1].complete(mountFixture)
  client.kernel[3].complete(performanceFixture({ at: 106, step: 3 }))
  await settle()
  assert.equal(getPerformanceMonitorState('host').metrics.mounts?.latest?.value[0].target, '/')
  assert.equal(getPerformanceMonitorState('host').metrics.network?.latest?.value[0].receiveBytesPerSecond, null)

  refreshPerformanceMonitor('host')
  client.mounts[2].complete('', 1)
  await settle()
  assert.ok(getPerformanceMonitorState('host').metrics.mounts?.error)
  assert.equal(getPerformanceMonitorState('host').metrics.mounts?.latest?.value[0].target, '/')
})
