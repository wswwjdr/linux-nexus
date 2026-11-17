import { messageFromUnknown, renderMessage } from '@shared/i18n/messages'

export interface SaveState {
  status: 'pending' | 'saving' | 'saved' | 'invalid' | 'failed'
  error?: string
}
interface SaveTask {
  save: () => Promise<void>
  discard: () => void
  timer?: ReturnType<typeof setTimeout>
  state: SaveState
}

/** Owns pending edits across settings pages and serializes writes. */
export class SettingsAutosave {
  private tasks = new Map<string, SaveTask>()
  private listeners = new Set<() => void>()
  private queue: Promise<void> = Promise.resolve()
  private snapshot: Readonly<Record<string, SaveState>> = {}

  /** Subscribes to save-state changes. @param listener Change callback. @returns Unsubscribe callback. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Returns the stable current save-state snapshot. @returns State indexed by editor. */
  getSnapshot = (): Readonly<Record<string, SaveState>> => this.snapshot

  /** Publishes updated state to subscribed views. */
  private publish(): void {
    this.snapshot = Object.fromEntries([...this.tasks].map(([key, task]) => [key, task.state]))
    for (const listener of this.listeners) listener()
  }

  /** Schedules the latest edit. @param key Editor identity. @param save Persistence action. @param discard Restore saved values. @param error Validation error. @param delay Debounce in milliseconds. */
  schedule(key: string, save: () => Promise<void>, discard: () => void, error?: string, delay = 500): void {
    const previous = this.tasks.get(key)
    clearTimeout(previous?.timer)
    const task: SaveTask = {
      save,
      discard,
      state: error ? { status: 'invalid', error } : { status: 'pending' },
    }
    this.tasks.set(key, task)
    if (!error) task.timer = setTimeout(() => this.enqueue(key, task), delay)
    this.publish()
  }

  /** Queues a still-current task. @param key Editor identity. @param task Captured edit. */
  private enqueue(key: string, task: SaveTask): void {
    clearTimeout(task.timer)
    task.timer = undefined
    this.queue = this.queue.then(async () => {
      if (this.tasks.get(key) !== task || task.state.status === 'saved') return
      task.state = { status: 'saving' }
      this.publish()
      try {
        await task.save()
        task.state = { status: 'saved' }
      } catch (error) {
        task.state = { status: 'failed', error: renderMessage(messageFromUnknown(error)) }
      }
      this.publish()
    })
  }

  /** Flushes pending edits and retries failed saves. @returns Whether every edit is saved. */
  async flush(): Promise<boolean> {
    for (const [key, task] of this.tasks) {
      if (task.state.status === 'pending' || task.state.status === 'failed') this.enqueue(key, task)
    }
    await this.queue
    return [...this.tasks.values()].every((task) => task.state.status === 'saved')
  }

  /** Restores unsaved editors and clears their pending work. */
  discard(): void {
    for (const [key, task] of this.tasks) {
      clearTimeout(task.timer)
      if (task.state.status !== 'saved') task.discard()
      this.tasks.delete(key)
    }
    this.publish()
  }
}
