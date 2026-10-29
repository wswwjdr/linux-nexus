import type { Writable } from 'node:stream'
export function waitForDrain(stream: Writable, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { stream.removeListener('drain', drain); stream.removeListener('close', close); stream.removeListener('error', error); signal?.removeEventListener('abort', abort) }
    const drain = () => { cleanup(); resolve() }
    const error = (value: Error) => { cleanup(); reject(value) }
    const close = () => error(new Error('输出流已关闭'))
    const abort = () => error(new Error('输出流已取消'))
    stream.once('drain', drain); stream.once('close', close); stream.once('error', error); signal?.addEventListener('abort', abort, { once: true })
    if (stream.destroyed || signal?.aborted) close()
  })
}
