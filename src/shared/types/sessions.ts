export type ConnectResult =
  | { ok: true; path: string; fileIdentity?: FileIdentity }
  | {
      ok: false
      reason: 'host-key-unknown'
      fingerprint: string
    }
  | {
      ok: false
      reason: 'host-key-changed'
      fingerprint: string
      previousFingerprint: string
    }
  | {
      ok: false
      reason: 'auth-failed' | 'unreachable' | 'other'
      message: string
    }

export interface TrustHostKeyInput {
  profileId: string
  fingerprint: string
  previousFingerprint?: string
}

export type SessionKind = 'files' | 'terminal'

export type FileIdentity = 'login' | 'sudo-root' | 'root-login'
export type FileElevationResult =
  | { status: 'entered'; identity: FileIdentity }
  | { status: 'password-required' }
  | { status: 'cancelled' }

export interface FileRootExpiredEvent {
  sessionId: string
  remoteStateUnknown: boolean
}

export interface TerminalOutputEvent {
  sessionId: string
  data: string
}

export interface ConnectionClosedEvent {
  sessionId: string
  profileId: string
  message: string
}
