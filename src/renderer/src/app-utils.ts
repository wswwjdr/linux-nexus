import { type MessageValue, formatLocale, msg, messageFromUnknown } from '@shared/i18n/messages'
import type { ConnectResult, PreviewLimits } from '@shared/types'
import type { PreviewLimitKey, PreviewLimitsForm, ProfileForm, RecentConnection } from './app-types'

export const previewLimitFields: { key: PreviewLimitKey; label: MessageValue }[] = [
  { key: 'textMiB', label: msg('common.textFileLimitMib') },
  { key: 'pdfMiB', label: msg('common.pdfFileLimitMib') },
  { key: 'imageMiB', label: msg('common.imageFileLimitMib') },
  { key: 'audioMiB', label: msg('common.audioFileLimitMib') },
  { key: 'videoMiB', label: msg('common.videoFileLimitMib') },
]

const collators = new Map<string, Intl.Collator>()
export const entryNameCollator = {
  compare(left: string, right: string): number {
    const locale = formatLocale()
    let collator = collators.get(locale)
    if (!collator) {
      collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
      collators.set(locale, collator)
    }
    return collator.compare(left, right)
  },
}

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
  const digits = value >= 10 ? 0 : 1
  return new Intl.NumberFormat(formatLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value) + ' ' + units[unit]
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat(formatLocale(), {
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

export function errorMessage(error: unknown): MessageValue {
  return messageFromUnknown(error)
}

export function connectFailureText(result: Exclude<ConnectResult, { ok: true }>): MessageValue {
  if (result.reason === 'auth-failed') return result.message
  if (result.reason === 'unreachable') return result.message
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
