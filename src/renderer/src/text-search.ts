/** Literal, non-overlapping matches; offsets always refer to the original text. */
export function findTextMatches(content: string, query: string, caseSensitive: boolean): number[] {
  if (!query) return []
  const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const expression = new RegExp(pattern, caseSensitive ? 'gu' : 'giu')
  const offsets: number[] = []
  for (const match of content.matchAll(expression)) offsets.push(match.index)
  return offsets
}
