import type { ClientChannel } from 'ssh2'
import type { PerformanceUpdate } from '../shared/types.ts'
import { createPerformanceSnapshot, parsePerformanceReport } from '../shared/performance.ts'
import { getMainWindow, sessions, type ActiveSession } from './runtime.ts'

const SAMPLE_INTERVAL_MS = 5_000
const COMMAND_TIMEOUT_MS = 4_500
const MAX_STDOUT_BYTES = 16 * 1024
const MAX_STDERR_BYTES = 2 * 1024

export const PERFORMANCE_COMMAND = `LC_ALL=C; export LC_ALL
printf 'cpu '; awk '$1 == "cpu" { for (i = 2; i <= 9; i++) printf "%s%s", $i, i == 9 ? ORS : OFS }' /proc/stat
printf 'mem '; awk '/^MemTotal:/ { total = $2 } /^MemAvailable:/ { available = $2 } END { if (total == "" || available == "") exit 1; printf "%.0f %.0f\\n", total, available }' /proc/meminfo
printf 'load '; awk '{ print $1, $2, $3 }' /proc/loadavg
printf 'uptime '; awk '{ print $1 }' /proc/uptime
printf 'cores '; getconf _NPROCESSORS_ONLN
printf 'disk '; df -P -B1 / | awk 'NR == 2 { print $2, $3, $4, $5 }'`

interface ActivePerformanceMonitor {
  sessionId: string
  monitorId: string
  session: ActiveSession
  timer: NodeJS.Timeout
  stream: ClientChannel | null
  previousCpuTicks: number[] | null
  inFlight: boolean
  stopped: boolean
}

const activeMonitors = new Map<string, ActivePerformanceMonitor>()

function sendUpdate(update: PerformanceUpdate): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) window.webContents.send('performance:update', update)
}

function current(monitor: ActivePerformanceMonitor): boolean {
  return !monitor.stopped
    && activeMonitors.get(monitor.sessionId) === monitor
    && sessions.get(monitor.sessionId) === monitor.session
}

function readRemoteReport(monitor: ActivePerformanceMonitor): Promise<string> {
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
        if (settled || !current(monitor)) {
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

async function sample(monitor: ActivePerformanceMonitor): Promise<void> {
  if (!current(monitor) || monitor.inFlight) return
  monitor.inFlight = true
  sendUpdate({ sessionId: monitor.sessionId, monitorId: monitor.monitorId, status: 'sampling' })
  try {
    const output = await readRemoteReport(monitor)
    if (!current(monitor)) return
    const raw = parsePerformanceReport(output)
    const snapshot = createPerformanceSnapshot(raw, monitor.previousCpuTicks)
    monitor.previousCpuTicks = raw.cpuTicks
    sendUpdate({ sessionId: monitor.sessionId, monitorId: monitor.monitorId, status: 'ready', snapshot })
  } catch (error) {
    if (!current(monitor)) return
    sendUpdate({
      sessionId: monitor.sessionId,
      monitorId: monitor.monitorId,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  } finally {
    monitor.inFlight = false
  }
}

export function startPerformanceMonitor(sessionId: string, monitorId: string): void {
  if (typeof monitorId !== 'string' || !monitorId || monitorId.length > 128) throw new Error('性能监控编号无效')
  const session = sessions.get(sessionId)
  if (!session) throw new Error('SSH 会话未连接')
  const previous = activeMonitors.get(sessionId)
  if (previous?.monitorId === monitorId) return
  if (previous) stopMonitor(previous)

  const monitor: ActivePerformanceMonitor = {
    sessionId,
    monitorId,
    session,
    timer: setInterval(() => { void sample(monitor) }, SAMPLE_INTERVAL_MS),
    stream: null,
    previousCpuTicks: null,
    inFlight: false,
    stopped: false,
  }
  activeMonitors.set(sessionId, monitor)
  void sample(monitor)
}

function stopMonitor(monitor: ActivePerformanceMonitor): void {
  if (monitor.stopped) return
  monitor.stopped = true
  clearInterval(monitor.timer)
  monitor.stream?.close()
  monitor.stream = null
  if (activeMonitors.get(monitor.sessionId) === monitor) activeMonitors.delete(monitor.sessionId)
}

export function stopPerformanceMonitor(sessionId: string, monitorId: string): void {
  const monitor = activeMonitors.get(sessionId)
  if (monitor?.monitorId === monitorId) stopMonitor(monitor)
}

export function stopPerformanceMonitorForSession(sessionId: string): void {
  const monitor = activeMonitors.get(sessionId)
  if (monitor) stopMonitor(monitor)
}

export function stopAllPerformanceMonitors(): void {
  for (const monitor of activeMonitors.values()) stopMonitor(monitor)
}

export function refreshPerformanceMonitor(sessionId: string, monitorId: string): void {
  const monitor = activeMonitors.get(sessionId)
  if (!monitor || monitor.monitorId !== monitorId || !current(monitor)) throw new Error('性能监控已停止')
  void sample(monitor)
}
