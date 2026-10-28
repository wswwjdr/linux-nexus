export type ConnectResult =
  | { ok: true; path: string }
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

export interface TerminalOutputEvent {
  sessionId: string
  data: string
}

export interface ConnectionClosedEvent {
  sessionId: string
  profileId: string
  message: string
}
