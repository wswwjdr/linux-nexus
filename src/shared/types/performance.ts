export interface PerformanceThreshold {
  warning: number
  critical: number
}

export interface PerformanceThresholds {
  cpu: PerformanceThreshold
  memory: PerformanceThreshold
  disk: PerformanceThreshold
  loadPerCore: PerformanceThreshold
}

export interface PerformanceSnapshot {
  sampledAt: string
  cpuPercent: number | null
  memoryPercent: number
  memoryUsedBytes: number
  memoryTotalBytes: number
  diskPercent: number
  diskUsedBytes: number
  diskTotalBytes: number
  loadAverage: [number, number, number]
  uptimeSeconds: number
  cpuCores: number
}

export interface PerformanceMonitorState {
  sessionId: string
  version: number
  status: 'inactive' | 'sampling' | 'ready' | 'error'
  snapshot: PerformanceSnapshot | null
  message: string | null
  history: PerformanceSnapshot[][]
}
