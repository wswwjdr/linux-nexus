import type { FileIdentity } from './sessions'
import type { MessageValue } from '../i18n/messages'

export type DependencyPurpose = 'connection' | 'archive-setup' | 'extract' | 'text-save' | 'media-preview'
  | 'log-preview' | 'image-preview' | 'text-preview' | 'markdown-preview' | 'download' | 'upload' | 'content-search'
  | 'properties' | 'directory-stats' | 'create-directory' | 'rename' | 'resolve-link' | 'delete' | 'copy' | 'move'

export interface DependencyIssue {
  id: string
  purpose: DependencyPurpose
  missing: string[]
  incompatible: string[]
  manager?: 'apt-get' | 'dnf' | 'yum'
  packages: string[]
  /** Optional initial archive setup lists the formats affected by the current report. */
  formats?: string[]
}

export type DependencyCheckResult =
  | { status: 'ready'; fileIdentity?: FileIdentity }
  | { status: 'missing'; issue: DependencyIssue }

export type DependencyInstallResult =
  | { status: 'installed' }
  | { status: 'password-required'; message?: MessageValue }
