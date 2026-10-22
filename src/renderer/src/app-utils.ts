import type { ConnectResult, PreviewLimits } from '@shared/types'
import type { PreviewLimitKey, PreviewLimitsForm, ProfileForm, RecentConnection } from './app-types'

export const previewLimitFields: { key: PreviewLimitKey; label: string }[] = [
  { key: 'textMiB', label: '文本文件上限（MiB）' },
  { key: 'pdfMiB', label: 'PDF 文件上限（MiB）' },
  { key: 'imageMiB', label: '图片文件上限（MiB）' },
  { key: 'audioMiB', label: '音频文件上限（MiB）' },
  { key: 'videoMiB', label: '视频文件上限（MiB）' },
]

export const entryNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

export const emptyForm = (): ProfileForm => ({
  id: '',
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
})

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return value.toFixed(value >= 10 ? 0 : 1) + ' ' + units[unit]
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export function readRecentConnections(): RecentConnection[] {
  const savedConnections = window.localStorage.getItem('remote-files:recent-connections')
  return savedConnections ? JSON.parse(savedConnections) as RecentConnection[] : []
}

export function getParentPath(remotePath: string): string {
  const parts = remotePath.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? '/' + parts.join('/') : '/'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请重试'
}

export function connectFailureText(result: Exclude<ConnectResult, { ok: true }>): string {
  if (result.reason === 'auth-failed') return result.message
  if (result.reason === 'unreachable') return result.message
  if (result.reason === 'sftp-unavailable') return '服务器未提供 SFTP：' + result.message
  if (result.reason === 'other') return result.message
  return ''
}

export function toPreviewLimitsForm(limits: PreviewLimits): PreviewLimitsForm {
  return {
    textMiB: String(limits.textMiB),
    pdfMiB: String(limits.pdfMiB),
    imageMiB: String(limits.imageMiB),
    audioMiB: String(limits.audioMiB),
    videoMiB: String(limits.videoMiB),
  }
}
