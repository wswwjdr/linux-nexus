import { LocalizedError, messageFromUnknown, msg } from '../shared/i18n/messages'
import { DEFAULT_APP_SETTINGS } from '../shared/app-settings'
import type { PerformanceMonitorState } from '../shared/types/performance'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { runRemoteCommand } from './ssh-commands'
import { calculatePerformanceMetrics, MOUNT_CAPACITY_COMMAND, parseMountCapacity, parsePerformanceSample, PERFORMANCE_COMMAND } from './performance-sampling'

const COMMAND_TIMEOUT_MS = 4_500
const MIN_MOUNT_INTERVAL_MS = 15_000
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 4096
const kernelMetrics = ['uptime', 'cpu', 'load', 'memory', 'swap', 'disks', 'network'] as const
type Metrics = PerformanceMonitorState['metrics']
type RawSample = ReturnType<typeof parsePerformanceSample>

interface SamplingRun {
  session: ActiveSession
  previous: RawSample | null
  metrics: Metrics
}

interface SamplingLane {
  kind: 'kernel' | 'mounts'
  timer?: NodeJS.Timeout
  attempt?: { run: SamplingRun; controller: AbortController }
}

const kernel: SamplingLane = { kind: 'kernel' }
const mounts: SamplingLane = { kind: 'mounts' }
const lanes = [kernel, mounts]
const enabled = new Map<string, ActiveSession>()
let focused: ActiveSession | null = null
let run: SamplingRun | null = null
let version = 0
let intervalMs = 1000 * DEFAULT_APP_SETTINGS.performanceSampleIntervalSeconds

/** Returns the latest monitor state for the focused connection. */
export function getPerformanceMonitorState(): PerformanceMonitorState {
  return {
    sessionId: focused?.sessionId ?? null,
    enabled: run !== null,
    sampling: Boolean(run && lanes.some((lane) => lane.attempt?.run === run)),
    metrics: run?.metrics ?? {},
    version,
  }
}

/** Publishes the current view with a version shared by responses and notifications. */
function publish(): PerformanceMonitorState {
  version += 1
  const state = getPerformanceMonitorState()
  const window = getMainWindow()
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('performance:update', state)
  }
  return state
}

/** Tests whether target can still apply results to the focused live connection. */
function isCurrent(target: SamplingRun): boolean {
  return run === target && sessions.get(target.session.sessionId) === target.session
}

/** Invalidates the current sampling run and cancels both of its lanes. */
function stop(): void {
  run = null
  for (const lane of lanes) {
    clearTimeout(lane.timer)
    lane.timer = undefined
    lane.attempt?.controller.abort()
  }
}

/** Schedules the next request in lane using the latest interval setting. */
function schedule(lane: SamplingLane): void {
  clearTimeout(lane.timer)
  const delay = lane.kind === 'mounts' ? Math.max(MIN_MOUNT_INTERVAL_MS, intervalMs) : intervalMs
  lane.timer = setTimeout(() => {
    lane.timer = undefined
    if (run) start(lane, run)
  }, delay)
}

/** Starts sampling for target when lane is idle, returning whether a request was started. */
function start(lane: SamplingLane, target: SamplingRun): boolean {
  if (!isCurrent(target) || lane.attempt) return false
  clearTimeout(lane.timer)
  lane.timer = undefined
  const attempt = { run: target, controller: new AbortController() }
  lane.attempt = attempt
  void collect(lane, attempt).finally(() => {
    lane.attempt = undefined
    if (!run) return
    if (isCurrent(target)) schedule(lane)
    else if (isCurrent(run)) start(lane, run)
    publish()
  })
  return true
}

/** Reads one SSH response and merges the lane's fresh values or errors into its live run. */
async function collect(lane: SamplingLane, { run: target, controller }: NonNullable<SamplingLane['attempt']>): Promise<void> {
  const keys = lane.kind === 'mounts' ? ['mounts'] as const : kernelMetrics
  try {
    const result = await runRemoteCommand(target.session.client,
      lane.kind === 'mounts' ? MOUNT_CAPACITY_COMMAND : PERFORMANCE_COMMAND, [], {
        signal: controller.signal, timeoutMs: COMMAND_TIMEOUT_MS, maxStdoutBytes: MAX_STDOUT_BYTES, maxStderrBytes: MAX_STDERR_BYTES,
      })
    if (!isCurrent(target)) return
    const output = result.stdout.toString('utf8')
    const sampledAt = Date.now()
    if (lane.kind === 'mounts') {
      target.metrics = { ...target.metrics, mounts: { latest: { sampledAt, value: parseMountCapacity(output) }, error: null } }
      return
    }
    const raw = parsePerformanceSample(output)
    const values = calculatePerformanceMetrics(raw, target.previous)
    const metrics = { ...target.metrics }

    /** Applies a checked result for key, retaining its last good value if this source failed. */
    function update<K extends keyof typeof values>(key: K): void {
      const result = values[key]
      const metric = result.value === undefined
        ? { latest: metrics[key]?.latest ?? null, error: result.error }
        : { latest: { sampledAt, value: result.value }, error: null }
      Object.assign(metrics, { [key]: metric })
    }

    for (const key of kernelMetrics) update(key)
    target.previous = raw
    target.metrics = metrics
  } catch (error) {
    if (!isCurrent(target)) return
    if (!(error instanceof LocalizedError)) {
      console.error('Performance sampling failed', error)
    }
    if (lane.kind === 'kernel') target.previous = null
    const message = messageFromUnknown(error)
    const metrics = { ...target.metrics }
    for (const key of keys) Object.assign(metrics, { [key]: { latest: metrics[key]?.latest ?? null, error: message } })
    target.metrics = metrics
  }
}

/** Starts both sampling lanes for session with fresh counter baselines. */
function begin(session: ActiveSession): void {
  const target: SamplingRun = { session, previous: null, metrics: {} }
  run = target
  for (const lane of lanes) start(lane, target)
}

/** Switches monitoring ownership to the connected session identified by sessionId, or clears focus. */
export function focusPerformanceMonitor(sessionId: string | null): PerformanceMonitorState {
  const session = sessionId === null ? null : sessions.get(sessionId) ?? null
  if (focused === session) return getPerformanceMonitorState()
  stop()
  focused = session
  if (session && enabled.get(session.sessionId) === session) begin(session)
  return publish()
}

/** Sets the monitor switch for the currently focused connection and returns its new state. */
export function setPerformanceMonitorEnabled(sessionId: string, value: boolean): PerformanceMonitorState {
  if (focused?.sessionId !== sessionId || sessions.get(sessionId) !== focused) return getPerformanceMonitorState()
  if (value === Boolean(run)) return getPerformanceMonitorState()
  if (value) {
    enabled.set(sessionId, focused)
    begin(focused)
  } else {
    enabled.delete(sessionId)
    stop()
  }
  return publish()
}

/** Refreshes both lanes for the matching active session, reusing in-flight work. */
export function refreshPerformanceMonitor(sessionId: string): void {
  if (run?.session.sessionId !== sessionId) return
  const kernelStarted = start(kernel, run)
  const mountsStarted = start(mounts, run)
  if (kernelStarted || mountsStarted) publish()
}

/** Applies seconds as the new sampling interval and replaces outstanding timers. */
export function configurePerformanceMonitorInterval(seconds: number): void {
  intervalMs = seconds * 1000
  if (!run) return
  for (const lane of lanes) if (lane.timer) schedule(lane)
}

/** Forgets the switch and releases resources belonging to the disconnected sessionId. */
export function removePerformanceMonitorForSession(sessionId: string): void {
  enabled.delete(sessionId)
  if (focused?.sessionId === sessionId) focusPerformanceMonitor(null)
}

/** Disposes all monitoring state when the application window closes. */
export function stopAllPerformanceMonitors(): void {
  enabled.clear()
  stop()
  focused = null
  version += 1
}
