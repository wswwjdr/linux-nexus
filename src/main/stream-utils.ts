import { msg, LocalizedError } from '../shared/i18n/messages'
import type { Writable } from 'node:stream'

export function waitWithSignal<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    void task.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) },
    )
  })
}

export function waitForDrain(stream: Writable, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { stream.removeListener('drain', drain); stream.removeListener('close', close); stream.removeListener('error', error); signal?.removeEventListener('abort', abort) }
    const drain = () => { cleanup(); resolve() }
    const error = (value: Error) => { cleanup(); reject(value) }
    const close = () => error(new LocalizedError(msg('errors.outputStreamClosed')))
    const abort = () => error(new LocalizedError(msg('errors.outputStreamCancelled')))
    stream.once('drain', drain); stream.once('close', close); stream.once('error', error); signal?.addEventListener('abort', abort, { once: true })
    if (stream.destroyed || signal?.aborted) close()
  })
}
