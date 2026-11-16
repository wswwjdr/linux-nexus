import { type MessageValue } from '../i18n/messages'
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

export interface CpuUsage {
  percent: number | null
  logical: { id: number; percent: number | null }[]
}

export interface ResourceCapacity {
  totalBytes: number
  usedBytes: number
  availableBytes: number
  percent: number | null
}

export interface MountUsage extends ResourceCapacity {
  target: string
  fsType: string
}

export interface DiskActivity {
  id: string
  name: string
  readBytesPerSecond: number | null
  writeBytesPerSecond: number | null
  readsPerSecond: number | null
  writesPerSecond: number | null
}

export interface NetworkActivity {
  name: string
  receiveBytesPerSecond: number | null
  transmitBytesPerSecond: number | null
}

export interface PerformanceMetricValues {
  cpu: CpuUsage
  memory: ResourceCapacity
  swap: ResourceCapacity
  load: [number, number, number]
  uptime: number
  mounts: MountUsage[]
  disks: DiskActivity[]
  network: NetworkActivity[]
}

export interface PerformanceMetric<T> {
  latest: { sampledAt: number; value: T } | null
  error: MessageValue | null
}

export interface PerformanceMonitorState {
  profileId: string
  connected: boolean
  version: number
  enabled: boolean
  sampling: boolean
  metrics: { [K in keyof PerformanceMetricValues]?: PerformanceMetric<PerformanceMetricValues[K]> }
}
