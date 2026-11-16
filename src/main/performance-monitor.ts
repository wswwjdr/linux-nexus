import { LocalizedError, messageFromUnknown } from '../shared/i18n/messages'
import { DEFAULT_APP_SETTINGS } from '../shared/app-settings'
import type { PerformanceMonitorState } from '../shared/types/performance'
import { getMainWindow, type ActiveSession } from './runtime'
import { runRemoteCommand } from './ssh-commands'
import { calculatePerformanceMetrics, MOUNT_CAPACITY_COMMAND, parseMountCapacity, parsePerformanceSample, PERFORMANCE_COMMAND } from './performance-sampling'

const COMMAND_TIMEOUT_MS = 4_500
const MIN_MOUNT_INTERVAL_MS = 15_000
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 4096
const kernelMetrics = ['uptime', 'cpu', 'load', 'memory', 'swap', 'disks', 'network'] as const
type Metrics = PerformanceMonitorState['metrics']
type RawSample = ReturnType<typeof parsePerformanceSample>

interface SamplingAttempt {
  session: ActiveSession
  controller: AbortController
}

interface SamplingLane {
  kind: 'kernel' | 'mounts'
  timer?: NodeJS.Timeout
  attempt?: SamplingAttempt
}

interface ServerMonitor {
  profileId: string
  connections: Set<ActiveSession>
  enabled: boolean
  previous: RawSample | null
  metrics: Metrics
  lanes: SamplingLane[]
}

const monitors = new Map<string, ServerMonitor>()
let version = 0
let intervalMs = 1000 * DEFAULT_APP_SETTINGS.performanceSampleIntervalSeconds

/**
 * Finds or creates the monitor for a server configuration.
 * @param profileId Server configuration ID.
 * @returns The monitor owned by the configuration.
 */
function monitorFor(profileId: string): ServerMonitor {
  const existing = monitors.get(profileId)
  if (existing) return existing
  const monitor: ServerMonitor = {
    profileId, connections: new Set(), enabled: false, previous: null, metrics: {},
    lanes: [{ kind: 'kernel' }, { kind: 'mounts' }],
  }
  monitors.set(profileId, monitor)
  return monitor
}

/**
 * Returns a snapshot of a server's monitoring state.
 * @param profileId Server configuration ID.
 * @returns The current snapshot, including the default state for an unused configuration.
 */
export function getPerformanceMonitorState(profileId: string): PerformanceMonitorState {
  const monitor = monitors.get(profileId)
  return {
    profileId,
    version,
    connected: Boolean(monitor?.connections.size),
    enabled: monitor?.enabled ?? false,
    sampling: monitor?.lanes.some((lane) => lane.attempt && !lane.attempt.controller.signal.aborted) ?? false,
    metrics: monitor?.metrics ?? {},
  }
}

/**
 * Publishes a new version of the server snapshot.
 * @param profileId Server configuration ID.
 * @returns The same snapshot sent to the renderer.
 */
function publish(profileId: string): PerformanceMonitorState {
  version += 1
  const state = getPerformanceMonitorState(profileId)
  const window = getMainWindow()
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('performance:update', state)
  }
  return state
}

/**
 * Checks whether an attempt can still update its server's readings.
 * @param monitor Server that started the attempt.
 * @param attempt Request to verify, with its own cancellation signal.
 * @returns Whether the server, connection, and request are still current.
 */
function isCurrent(monitor: ServerMonitor, attempt: SamplingAttempt): boolean {
  return !attempt.controller.signal.aborted
    && monitors.get(monitor.profileId) === monitor
    && monitor.connections.has(attempt.session)
}

/**
 * Cancels sampling and resets the baseline for the next connection or run.
 * @param monitor Server whose sampling is being stopped.
 */
function stopSampling(monitor: ServerMonitor): void {
  monitor.previous = null
  for (const lane of monitor.lanes) {
    clearTimeout(lane.timer)
    lane.timer = undefined
    lane.attempt?.controller.abort()
  }
}

/**
 * Schedules a lane's next sample at the configured interval.
 * @param monitor Server to sample.
 * @param lane Metric group and its timer.
 */
function schedule(monitor: ServerMonitor, lane: SamplingLane): void {
  clearTimeout(lane.timer)
  const delay = lane.kind === 'mounts' ? Math.max(MIN_MOUNT_INTERVAL_MS, intervalMs) : intervalMs
  lane.timer = setTimeout(() => {
    lane.timer = undefined
    if (start(monitor, lane)) publish(monitor.profileId)
  }, delay)
}

/**
 * Starts an idle lane using the oldest remaining connection.
 * @param monitor Server to sample.
 * @param lane Metric group and its current request.
 * @returns Whether a new request started.
 */
function start(monitor: ServerMonitor, lane: SamplingLane): boolean {
  if (!monitor.enabled || lane.attempt) return false
  const session = monitor.connections.values().next().value
  if (!session) return false
  clearTimeout(lane.timer)
  lane.timer = undefined
  const attempt = { session, controller: new AbortController() }
  lane.attempt = attempt
  void collect(monitor, lane, attempt).finally(() => {
    // Wait for cancellation to settle before reusing the lane, even after a rapid re-enable.
    lane.attempt = undefined
    if (monitors.get(monitor.profileId) !== monitor || !monitor.enabled || !monitor.connections.size) return
    if (isCurrent(monitor, attempt)) schedule(monitor, lane)
    else start(monitor, lane)
    publish(monitor.profileId)
  })
  return true
}

/**
 * Starts any idle lanes for the server.
 * @param monitor Server whose readings are due.
 * @returns Whether at least one request started.
 */
function startSampling(monitor: ServerMonitor): boolean {
  let started = false
  for (const lane of monitor.lanes) {
    if (start(monitor, lane)) started = true
  }
  return started
}

/**
 * Reads one SSH response and merges the results if the attempt still owns the connection.
 * @param monitor Server receiving the readings.
 * @param lane Metric group being sampled.
 * @param attempt Connection and cancellation state for the request.
 * @returns A promise that resolves after applying or discarding the result.
 */
async function collect(monitor: ServerMonitor, lane: SamplingLane, attempt: SamplingAttempt): Promise<void> {
  const { session, controller } = attempt
  const keys = lane.kind === 'mounts' ? ['mounts'] as const : kernelMetrics
  try {
    const result = await runRemoteCommand(session.client,
      lane.kind === 'mounts' ? MOUNT_CAPACITY_COMMAND : PERFORMANCE_COMMAND, [], {
        signal: controller.signal, timeoutMs: COMMAND_TIMEOUT_MS, maxStdoutBytes: MAX_STDOUT_BYTES, maxStderrBytes: MAX_STDERR_BYTES,
      })
    if (!isCurrent(monitor, attempt)) return
    const output = result.stdout.toString('utf8')
    const sampledAt = Date.now()
    if (lane.kind === 'mounts') {
      monitor.metrics = { ...monitor.metrics, mounts: { latest: { sampledAt, value: parseMountCapacity(output) }, error: null } }
      return
    }
    const raw = parsePerformanceSample(output)
    const values = calculatePerformanceMetrics(raw, monitor.previous)
    const metrics = { ...monitor.metrics }

    /**
     * Applies the result, retaining its last good value if the source failed.
     * @param key Metric to update.
     */
    function update<K extends keyof typeof values>(key: K): void {
      const result = values[key]
      const metric = result.value === undefined
        ? { latest: metrics[key]?.latest ?? null, error: result.error }
        : { latest: { sampledAt, value: result.value }, error: null }
      Object.assign(metrics, { [key]: metric })
    }

    for (const key of kernelMetrics) update(key)
    monitor.previous = raw
    monitor.metrics = metrics
  } catch (error) {
    if (!isCurrent(monitor, attempt)) return
    if (!(error instanceof LocalizedError)) {
      console.error('Performance sampling failed', error)
    }
    if (lane.kind === 'kernel') monitor.previous = null
    const message = messageFromUnknown(error)
    const metrics = { ...monitor.metrics }
    for (const key of keys) Object.assign(metrics, { [key]: { latest: metrics[key]?.latest ?? null, error: message } })
    monitor.metrics = metrics
  }
}

/**
 * Registers a live connection and resumes enabled monitoring on the first connection.
 * @param session Connected SSH session to register.
 */
export function registerPerformanceConnection(session: ActiveSession): void {
  const monitor = monitorFor(session.profileId)
  if (monitor.connections.has(session)) return
  monitor.connections.add(session)
  if (monitor.connections.size !== 1) return
  startSampling(monitor)
  publish(monitor.profileId)
}

/**
 * Removes a live connection and transfers sampling when it was the oldest connection.
 * @param session Exact session object that is closing.
 */
export function unregisterPerformanceConnection(session: ActiveSession): void {
  const monitor = monitors.get(session.profileId)
  if (!monitor) return
  const samplingConnection = monitor.connections.values().next().value
  if (!monitor.connections.delete(session) || samplingConnection !== session) return
  stopSampling(monitor)
  if (monitor.connections.size) startSampling(monitor)
  else monitor.metrics = {}
  publish(monitor.profileId)
}

/**
 * Sets a server's shared switch and starts or stops its sampling.
 * @param profileId Server configuration ID.
 * @param enabled Desired switch value.
 * @returns The updated server snapshot.
 */
export function setPerformanceMonitorEnabled(profileId: string, enabled: boolean): PerformanceMonitorState {
  const monitor = monitorFor(profileId)
  if (monitor.enabled === enabled) return getPerformanceMonitorState(profileId)
  monitor.enabled = enabled
  if (enabled) startSampling(monitor)
  else {
    stopSampling(monitor)
    monitor.metrics = {}
  }
  return publish(profileId)
}

/**
 * Requests fresh readings for an enabled server, reusing pending work.
 * @param profileId Server configuration ID.
 */
export function refreshPerformanceMonitor(profileId: string): void {
  const monitor = monitors.get(profileId)
  if (monitor && startSampling(monitor)) publish(profileId)
}

/**
 * Applies the new interval to the scheduled lanes of all servers.
 * @param seconds Sampling interval, in seconds.
 */
export function configurePerformanceMonitorInterval(seconds: number): void {
  intervalMs = seconds * 1000
  for (const monitor of monitors.values()) {
    for (const lane of monitor.lanes) {
      if (lane.timer !== undefined) schedule(monitor, lane)
    }
  }
}

/**
 * Discards a deleted or reconfigured server's monitor before its old connections close.
 * @param profileId Server configuration ID.
 */
export function removePerformanceMonitor(profileId: string): void {
  const monitor = monitors.get(profileId)
  if (!monitor) return
  monitors.delete(profileId)
  stopSampling(monitor)
  publish(profileId)
}

/** Releases all monitor resources and switches on application exit. */
export function stopAllPerformanceMonitors(): void {
  for (const monitor of monitors.values()) stopSampling(monitor)
  monitors.clear()
  version += 1
}
