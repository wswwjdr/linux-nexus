import type { ClientChannel } from 'ssh2'
import { DEFAULT_APP_SETTINGS } from '../shared/app-settings.ts'
import type { PerformanceMonitorState, PerformanceSnapshot } from '../shared/types.ts'
import { createPerformanceSnapshot, parsePerformanceReport } from '../shared/performance.ts'
import { getMainWindow, sessions, type ActiveSession } from './runtime.ts'

const COMMAND_TIMEOUT_MS = 4_500
const MAX_STDOUT_BYTES = 16 * 1024
const MAX_STDERR_BYTES = 2 * 1024
const HISTORY_WINDOW_MS = 15 * 60 * 1000

export const PERFORMANCE_COMMAND = `LC_ALL=C; export LC_ALL
printf 'cpu '; awk '$1 == "cpu" { for (i = 2; i <= 9; i++) printf "%s%s", $i, i == 9 ? ORS : OFS }' /proc/stat
printf 'mem '; awk '/^MemTotal:/ { total = $2 } /^MemAvailable:/ { available = $2 } END { if (total == "" || available == "") exit 1; printf "%.0f %.0f\\n", total, available }' /proc/meminfo
printf 'load '; awk '{ print $1, $2, $3 }' /proc/loadavg
printf 'uptime '; awk '{ print $1 }' /proc/uptime
printf 'cores '; getconf _NPROCESSORS_ONLN
printf 'disk '; df -P -B1 / | awk 'NR == 2 { print $2, $3, $4, $5 }'`

interface SessionPerformanceMonitor {
  sessionId: string
  session: ActiveSession
  timer: NodeJS.Timeout | null
  stream: ClientChannel | null
  previousCpuTicks: number[] | null
  inFlight: boolean
  sampleRequested: boolean
  active: boolean
  generation: number
  rescheduleAfterSample: boolean
  segmentOpen: boolean
  state: PerformanceMonitorState
}

const monitors = new Map<string, SessionPerformanceMonitor>()
let sampleIntervalSeconds = DEFAULT_APP_SETTINGS.performanceSampleIntervalSeconds
let nextVersion = 0

function cloneState(state: PerformanceMonitorState): PerformanceMonitorState {
  return { ...state, history: state.history.map((segment) => [...segment]) }
}

function current(monitor: SessionPerformanceMonitor): boolean {
  return monitor.active
    && monitors.get(monitor.sessionId) === monitor
    && sessions.get(monitor.sessionId) === monitor.session
}

function publish(monitor: SessionPerformanceMonitor): PerformanceMonitorState {
  pruneHistory(monitor, Date.now())
  monitor.state.version = ++nextVersion
  const state = cloneState(monitor.state)
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('performance:update', state)
  return state
}

function pruneHistory(monitor: SessionPerformanceMonitor, now: number): void {
  const earliest = now - HISTORY_WINDOW_MS
  monitor.state.history = monitor.state.history.flatMap((segment) => {
    const retained = segment.filter((snapshot) => Date.parse(snapshot.sampledAt) >= earliest)
    return retained.length ? [retained] : []
  })
}

function readRemoteReport(monitor: SessionPerformanceMonitor, generation: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let stream: ClientChannel | null = null
    let settled = false
    let exitCode: number | null = null
    let stdoutBytes = 0
    let stderrBytes = 0
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    const cleanup = () => {
      clearTimeout(timeout)
      monitor.session.client.removeListener('error', onClientError)
      monitor.session.client.removeListener('end', onClientEnd)
      monitor.session.client.removeListener('close', onClientClose)
      stream?.removeListener('data', onData)
      stream?.stderr.removeListener('data', onStderr)
      stream?.removeListener('error', onStreamError)
      stream?.removeListener('exit', onExit)
      stream?.removeListener('close', onClose)
      if (monitor.stream === stream) monitor.stream = null
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve(Buffer.concat(stdout).toString('utf8'))
    }
    const onClientError = (error: Error) => finish(new Error('SSH 连接失败：' + error.message))
    const onClientEnd = () => finish(new Error('SSH 连接已结束'))
    const onClientClose = () => finish(new Error('SSH 连接已关闭'))
    const onData = (chunk: Buffer) => {
      const data = Buffer.from(chunk)
      stdoutBytes += data.length
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        stream?.close()
        finish(new Error('远端性能数据超过大小限制'))
        return
      }
      stdout.push(data)
    }
    const onStderr = (chunk: Buffer) => {
      if (stderrBytes >= MAX_STDERR_BYTES) return
      const data = Buffer.from(chunk).subarray(0, MAX_STDERR_BYTES - stderrBytes)
      stderrBytes += data.length
      stderr.push(data)
    }
    const onStreamError = (error: Error) => finish(error)
    const onExit = (code: number | null) => { exitCode = typeof code === 'number' ? code : null }
    const onClose = () => {
      if (exitCode === 0) finish()
      else {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        finish(new Error(detail || '远端性能采集命令失败（退出码 ' + (exitCode ?? '未知') + '）'))
      }
    }
    const timeout = setTimeout(() => {
      stream?.close()
      finish(new Error('远端性能采集超时'))
    }, COMMAND_TIMEOUT_MS)

    monitor.session.client.on('error', onClientError)
    monitor.session.client.once('end', onClientEnd)
    monitor.session.client.once('close', onClientClose)
    try {
      monitor.session.client.exec(PERFORMANCE_COMMAND, (error, commandStream) => {
        if (error) {
          finish(error)
          return
        }
        stream = commandStream
        monitor.stream = commandStream
        if (settled || !current(monitor) || monitor.generation !== generation) {
          commandStream.close()
          finish(new Error('性能采集已停止'))
          return
        }
        commandStream.on('data', onData)
        commandStream.stderr.on('data', onStderr)
        commandStream.once('error', onStreamError)
        commandStream.once('exit', onExit)
        commandStream.once('close', onClose)
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function scheduleNextSample(monitor: SessionPerformanceMonitor, sampleStartedAt: number): void {
  if (!current(monitor)) return
  const delay = monitor.rescheduleAfterSample
    ? sampleIntervalSeconds * 1000
    : Math.max(0, sampleStartedAt + sampleIntervalSeconds * 1000 - Date.now())
  monitor.rescheduleAfterSample = false
  monitor.timer = setTimeout(() => {
    monitor.timer = null
    void sample(monitor)
  }, delay)
}

async function sample(monitor: SessionPerformanceMonitor): Promise<void> {
  if (!current(monitor)) return
  if (monitor.inFlight) {
    monitor.sampleRequested = true
    return
  }
  monitor.inFlight = true
  monitor.sampleRequested = false
  const generation = monitor.generation
  const sampleStartedAt = Date.now()
  monitor.state.status = 'sampling'
  monitor.state.message = null
  publish(monitor)
  try {
    const output = await readRemoteReport(monitor, generation)
    if (!current(monitor) || monitor.generation !== generation) return
    const raw = parsePerformanceReport(output)
    const snapshot = createPerformanceSnapshot(raw, monitor.previousCpuTicks)
    monitor.previousCpuTicks = raw.cpuTicks
    appendSnapshot(monitor, snapshot)
    monitor.state.snapshot = snapshot
    monitor.state.status = 'ready'
    monitor.state.message = null
    publish(monitor)
  } catch (error) {
    if (!current(monitor) || monitor.generation !== generation) return
    monitor.previousCpuTicks = null
    monitor.segmentOpen = false
    monitor.state.status = 'error'
    monitor.state.message = error instanceof Error ? error.message : String(error)
    publish(monitor)
  } finally {
    monitor.inFlight = false
    if (!current(monitor)) return
    if (monitor.sampleRequested) {
      monitor.sampleRequested = false
      void sample(monitor)
    } else {
      scheduleNextSample(monitor, sampleStartedAt)
    }
  }
}

function appendSnapshot(monitor: SessionPerformanceMonitor, snapshot: PerformanceSnapshot): void {
  if (!monitor.segmentOpen) {
    monitor.state.history.push([])
    monitor.segmentOpen = true
  }
  monitor.state.history[monitor.state.history.length - 1].push(snapshot)
  pruneHistory(monitor, Date.now())
}

function createMonitor(sessionId: string, session: ActiveSession): SessionPerformanceMonitor {
  return {
    sessionId,
    session,
    timer: null,
    stream: null,
    previousCpuTicks: null,
    inFlight: false,
    sampleRequested: false,
    active: false,
    generation: 0,
    rescheduleAfterSample: false,
    segmentOpen: false,
    state: {
      sessionId,
      version: nextVersion,
      status: 'inactive',
      snapshot: null,
      message: null,
      history: [],
    },
  }
}

export function getPerformanceMonitorState(sessionId: string): PerformanceMonitorState {
  const monitor = monitors.get(sessionId)
  if (!monitor) {
    return {
      sessionId,
      version: nextVersion,
      status: 'inactive',
      snapshot: null,
      message: null,
      history: [],
    }
  }
  pruneHistory(monitor, Date.now())
  return cloneState(monitor.state)
}

export function activatePerformanceMonitor(sessionId: string): PerformanceMonitorState {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('SSH 会话未连接')
  let monitor = monitors.get(sessionId)
  if (monitor && monitor.session !== session) {
    removePerformanceMonitorForSession(sessionId)
    monitor = undefined
  }
  if (!monitor) {
    monitor = createMonitor(sessionId, session)
    monitors.set(sessionId, monitor)
  }
  if (monitor.active) return getPerformanceMonitorState(sessionId)
  monitor.active = true
  monitor.generation += 1
  monitor.previousCpuTicks = null
  monitor.segmentOpen = false
  monitor.state.status = 'sampling'
  monitor.state.message = null
  monitor.sampleRequested = monitor.inFlight
  publish(monitor)
  if (!monitor.inFlight) void sample(monitor)
  return getPerformanceMonitorState(sessionId)
}

export function deactivatePerformanceMonitor(sessionId: string): void {
  const monitor = monitors.get(sessionId)
  if (!monitor || !monitor.active) return
  monitor.active = false
  monitor.generation += 1
  monitor.sampleRequested = false
  monitor.segmentOpen = false
  if (monitor.timer) clearTimeout(monitor.timer)
  monitor.timer = null
  monitor.stream?.close()
  monitor.stream = null
  monitor.state.status = 'inactive'
  monitor.state.message = null
  publish(monitor)
}

export function removePerformanceMonitorForSession(sessionId: string): void {
  const monitor = monitors.get(sessionId)
  if (!monitor) return
  monitor.active = false
  monitor.generation += 1
  monitor.sampleRequested = false
  if (monitor.timer) clearTimeout(monitor.timer)
  monitor.timer = null
  monitor.stream?.close()
  monitor.stream = null
  monitors.delete(sessionId)
  nextVersion += 1
}

export function configurePerformanceMonitorInterval(seconds: number): void {
  sampleIntervalSeconds = seconds
  for (const monitor of monitors.values()) {
    if (!monitor.active) continue
    if (monitor.inFlight) {
      monitor.rescheduleAfterSample = true
      continue
    }
    if (monitor.timer) clearTimeout(monitor.timer)
    monitor.timer = setTimeout(() => {
      monitor.timer = null
      void sample(monitor)
    }, sampleIntervalSeconds * 1000)
  }
}

export function stopAllPerformanceMonitors(): void {
  for (const sessionId of monitors.keys()) removePerformanceMonitorForSession(sessionId)
  monitors.clear()
}

export function refreshPerformanceMonitor(sessionId: string): void {
  const monitor = monitors.get(sessionId)
  if (!monitor || !current(monitor)) throw new Error('性能监控当前未启用')
  if (monitor.timer) clearTimeout(monitor.timer)
  monitor.timer = null
  void sample(monitor)
}
