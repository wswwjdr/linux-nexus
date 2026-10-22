export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('Shell 参数不能包含 NUL 字符')
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function scriptExecutionCommand(fileName: string): string {
  return './' + shellQuote(fileName)
}
