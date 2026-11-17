import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { messageFromError } from './runtime'

/** Atomically replaces the JSON file at filePath with value. */
export function atomicWriteJson(filePath: string, value: unknown): void {
  const temporaryFile = filePath + '.' + process.pid + '.' + randomUUID() + '.tmp'
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporaryFile, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(value, null, 2), { encoding: 'utf8' })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryFile, filePath)
  } catch (error) {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {
        /* Preserve the original write error. */
      }
    }
    try {
      unlinkSync(temporaryFile)
    } catch {
      /* The temporary file may not exist. */
    }
    throw new LocalizedError(
      msg('errors.cannotSafelySaveConfigurationFile', { filePath: filePath, value2: messageFromError(error) }),
      { cause: error },
    )
  }
}
