export function remoteRegexError(query: string): string | null {
  let inCharacterClass = false
  for (let index = 0; index < query.length; index += 1) {
    const character = query[index]
    if (character === '\\') {
      const escaped = query[index + 1]
      if (escaped !== undefined && !inCharacterClass
        && ((escaped >= '1' && escaped <= '9') || (escaped === 'k' && query[index + 2] === '<'))) {
        return '正则不支持反向引用、lookaround 或扩展分组'
      }
      index += 1
      continue
    }
    if (inCharacterClass) {
      if (character === ']') inCharacterClass = false
      continue
    }
    if (character === '[') {
      inCharacterClass = true
      continue
    }
    if (character === '(' && query[index + 1] === '?') {
      return '正则不支持反向引用、lookaround 或扩展分组'
    }
  }

  try {
    new RegExp(query)
  } catch {
    return '正则表达式无效，请检查括号、字符组和量词'
  }
  return null
}
