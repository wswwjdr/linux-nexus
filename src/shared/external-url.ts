export function validateExternalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('外部链接无效')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('外部链接无效')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) {
    throw new Error('仅允许打开 HTTP 或 HTTPS 链接')
  }
  return url.href
}
