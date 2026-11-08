import { msg, LocalizedError } from './i18n/messages'
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new LocalizedError(msg('errors.shellArgumentsMustNotContainNul'))
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function shellQuoteIfNeeded(value: string): string {
  return /^[a-zA-Z0-9_./-]+$/.test(value) ? value : shellQuote(value)
}

export function scriptExecutionCommand(fileName: string): string {
  return './' + shellQuote(fileName)
}
