const maxWindowsVersionPart = 65_535
const beijingTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/**
 * Reads a formal release tag and validates its calendar fields and Windows version range.
 * @param tag Version tag prefixed with v.
 * @returns Public and internal versions for this release.
 */
export function parseReleaseTag(tag: string) {
  const parts = /^v([1-9]\d{0,4})\.(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(tag)
  if (!parts || parts[0] !== tag) throw new Error(`Invalid release tag: ${tag}`)
  const [major, year, month, day, hour, minute] = parts.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const monthIndex = year * 12 + month - 1
  if (major > maxWindowsVersionPart || monthIndex > maxWindowsVersionPart
    || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) {
    throw new Error(`Invalid release tag: ${tag}`)
  }
  const minuteIndex = (day - 1) * 1440 + hour * 60 + minute
  return { tag, displayVersion: tag.slice(1), version: `${major}.${monthIndex}.${minuteIndex}` }
}

/**
 * Creates a release tag for the Beijing calendar minute containing the given instant.
 * @param major Maintainer-selected major version.
 * @param now Instant sampled immediately before tagging.
 * @returns Validated release tag.
 */
export function createReleaseTag(major: string, now = new Date()): string {
  const parts = Object.fromEntries(beijingTime.formatToParts(now).map(part => [part.type, part.value]))
  const tag = `v${major}.${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}`
  return parseReleaseTag(tag).tag
}

/**
 * Compares the numeric components of internal versions.
 * @param left First internal version.
 * @param right Second internal version.
 * @returns Negative, zero, or positive when left is older, equal, or newer.
 */
export function compareReleaseVersions(left: string, right: string): number {
  const [leftMajor, leftMonth, leftMinute] = left.split('.').map(Number)
  const [rightMajor, rightMonth, rightMinute] = right.split('.').map(Number)
  return leftMajor - rightMajor || leftMonth - rightMonth || leftMinute - rightMinute
}
