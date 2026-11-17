import type { MessageValue } from '../i18n/messages'

export interface LocalEditTask {
  id: string
  name: string
  remotePath: string
  server: string
  state: 'ready' | 'modified' | 'unavailable'
  busy: boolean
  autoUpload: boolean
  conflict?: true
  error?: MessageValue
}

export type LocalEditOutcome =
  | { type: 'saved'; sessionId: string; remotePath: string }
  | { type: 'failed'; error: MessageValue }

export interface LocalEditUpdate {
  tasks: LocalEditTask[]
  outcome?: LocalEditOutcome
}
