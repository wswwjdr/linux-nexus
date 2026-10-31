/** Resolve only image schemes supported by the reader; server paths keep the document's capability token. */
export function markdownImageUrl(value: string, resourceBaseUrl: string): string | null {
  try {
    const base = new URL(resourceBaseUrl)
    const url = new URL(value, base)
    if (url.username || url.password) return null
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
    if (url.protocol === 'remote-preview:' && url.host === base.host) return url.href
    return null
  } catch { return null }
}
