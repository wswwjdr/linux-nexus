export const terminalHistoryOsc = 6973

export interface TerminalHistoryEntry {
  number: string
  command: string
}

/** Encodes one part of a Readline history selection.
 * @param key Event-number digit, or the start or end marker for a selection request.
 * @returns The escape sequence assigned to this part of the request.
 */
export function terminalHistoryKey(key: string): string {
  return `\x1b[99;${key}~`
}
