import { msg, LocalizedError } from './i18n/messages'
export function validateExternalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new LocalizedError(msg('errors.invalidExternalLink'))
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new LocalizedError(msg('errors.invalidExternalLink'))
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
    throw new LocalizedError(msg('errors.onlyHttpOrHttpsLinksAreAllowed'))
  }
  return url.href
}
