export interface UpdateRelease {
  version: string
  notes: string
}

export type UpdatePhase =
  | { phase: 'idle' | 'checking' | 'current' | 'check-failed' }
  | { phase: 'available' | 'installing' | 'download-failed' | 'install-failed'; release: UpdateRelease }
  | { phase: 'downloading'; release: UpdateRelease; received: number; total: number | null }

export type UpdateState = UpdatePhase & {
  revision: number
  currentVersion: string
  enabled: boolean
}
