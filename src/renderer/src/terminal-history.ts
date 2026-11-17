import type { IMarker, Terminal } from '@xterm/xterm'
import { type TerminalHistoryEntry, terminalHistoryKey, terminalHistoryOsc } from '@shared/terminal-history'

export interface TerminalHistoryView {
  input: string
  row: number
  matches: TerminalHistoryEntry[]
}

const controlCharacter = /[\x00-\x1f\x7f-\x9f]/u
const lineEditingInput = /^(?:[\x01\x02\x04\x05\x06\x08\x09\x0b\x0c\x0e\x10\x14\x15\x17\x19\x7f]|\x1b(?:\[|O)(?:[A-DHF]|[13478]~|1;[2-8][A-DHF]))$/u

/** Decodes a complete Bash history snapshot, preserving each command's whitespace.
 * @param output The decoded output of Bash's history builtin.
 * @param token The marker separating each event's number from its command text.
 * @returns Distinct history entries ordered newest first.
 */
export function parseTerminalHistory(output: string, token: string): TerminalHistoryEntry[] {
  if (!/^[0-9a-f]{32}$/.test(token)) return []
  const header = new RegExp(`^ *([1-9][0-9]*)[ *] +\\x01${token}\\x02`, 'gm')
  const records = [...output.matchAll(header)]
  if (records[0]?.index !== 0) return []
  const entries = new Map<string, TerminalHistoryEntry>()
  for (let index = records.length - 1; index >= 0; index--) {
    const record = records[index]
    const end = records[index + 1]?.index ?? output.length
    const command = output.slice(record.index + record[0].length, end).replace(/\n$/, '')
    if (command && !entries.has(command)) entries.set(command, { number: record[1], command })
  }
  return [...entries.values()]
}

/** Checks the full input against every history entry, ignoring letter case.
 * @param entries History entries in recency order.
 * @param input The current Bash input line.
 * @returns All matching entries in the original order.
 */
export function matchTerminalHistory(entries: readonly TerminalHistoryEntry[], input: string): TerminalHistoryEntry[] {
  if (!input) return []
  const query = input.toLowerCase()
  return entries.filter(({ command }) => command.toLowerCase().includes(query))
}

/** Returns whether the given history entry can be placed on a single Readline input line. */
export function canInsertTerminalHistory(entry: TerminalHistoryEntry): boolean {
  return !controlCharacter.test(entry.command)
}

/** Tracks Bash prompt and history state for one terminal instance.
 * @param terminal The xterm receiving the PTY's output.
 * @param show Callback for the current matches and popup position, or null when hidden.
 * @returns The handlers for terminal input, history selection, and session changes.
 */
export function observeTerminalHistory(terminal: Terminal, show: (view: TerminalHistoryView | null) => void) {
  let token: string | undefined
  let snapshot: string[] | undefined
  let entries: TerminalHistoryEntry[] = []
  let prompt: { marker: IMarker; column: number } | undefined
  let awaitingPrompt = true
  let edited = false
  let view: TerminalHistoryView | null = null
  let matchedEntries = entries
  let lastInput = ''
  let lastRow = 0

  /** Publishes matching results when the input, anchor row, or history changes.
   * @param input The visible command line, or an empty string to hide the popup.
   * @param row The terminal cursor's viewport row.
   */
  function publish(input: string, row: number): void {
    if (input === lastInput && row === lastRow && matchedEntries === entries) return
    const matches = input === lastInput && matchedEntries === entries ? view?.matches ?? [] : matchTerminalHistory(entries, input)
    lastInput = input
    lastRow = row
    matchedEntries = entries
    view = matches.length ? { input, row, matches } : null
    show(view)
  }

  /** Releases the current prompt position and hides any visible history matches. */
  function releasePrompt(): void {
    prompt?.marker.dispose()
    prompt = undefined
    publish('', 0)
  }

  /** Reads the visible logical line after the Bash prompt, including soft-wrapped rows. */
  function refresh(): void {
    const buffer = terminal.buffer.active
    if (!prompt || prompt.marker.isDisposed || !edited || buffer.type !== 'normal' || buffer.viewportY !== buffer.baseY) {
      publish('', 0)
      return
    }
    const start = prompt.marker.line
    const cursor = buffer.baseY + buffer.cursorY
    if (start < 0 || cursor < start) { publish('', 0); return }

    let end = start
    while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped) end++
    if (cursor > end) {
      publish('', 0)
      return
    }

    let input = ''
    for (let row = start; row <= end; row++) {
      const line = buffer.getLine(row)!
      const from = row === start ? prompt.column : 0
      // At end of line the cursor distinguishes typed spaces from unused terminal cells.
      const text = line.translateToString(true, from)
      input += row === cursor ? line.translateToString(false, from, Math.max(from, buffer.cursorX)) +
        line.translateToString(true, Math.max(from, buffer.cursorX)) : text
    }
    publish(input, buffer.cursorY)
  }

  /** Drops all cached data and optionally accepts frames from the next PTY token. */
  function reset(nextToken?: string): void {
    token = nextToken
    snapshot = undefined
    entries = []
    matchedEntries = entries
    awaitingPrompt = true
    edited = false
    releasePrompt()
  }

  /** Sets the identifier for frames from the next PTY before passing its output to xterm. */
  function setToken(nextToken?: string): void {
    if (token !== nextToken) reset(nextToken)
  }

  /** Processes a history or prompt frame received by xterm.
   * @param frame The OSC payload, including its PTY token.
   * @returns Whether this history integration consumed the frame.
   */
  function handleFrame(frame: string): boolean {
    if (!token || !frame.startsWith(token + ';')) return false
    const body = frame.slice(token.length + 1)
    if (body === 'begin;') snapshot = []
    else if (body.startsWith('chunk;') && snapshot) snapshot.push(body.slice(6))
    else if (body === 'end;' && snapshot) {
      try {
        const bytes = Uint8Array.from(atob(snapshot.join('')), char => char.charCodeAt(0))
        entries = parseTerminalHistory(new TextDecoder('utf-8', { fatal: true }).decode(bytes), token)
      } catch (error) {
        if (!(error instanceof DOMException || error instanceof TypeError)) throw error
        entries = []
      }
      snapshot = undefined
    } else if (body === 'busy') {
      awaitingPrompt = true
      edited = false
      releasePrompt()
    } else if (body === 'prompt;') {
      awaitingPrompt = false
      edited = false
      releasePrompt()
    } else if (body === 'input' && !awaitingPrompt && terminal.buffer.active.type === 'normal') {
      prompt?.marker.dispose()
      const marker = terminal.registerMarker()
      if (marker) prompt = { marker, column: terminal.buffer.active.cursorX }
    }
    return true
  }

  /** Observes the data sent to Bash so that submitting or leaving the input line hides matches. */
  function observeInput(data: string): void {
    if (!prompt) return
    const paste = data.startsWith('\x1b[200~') && data.endsWith('\x1b[201~')
    const text = paste ? data.slice(6, -6) : data
    if (/[\r\n\x03]/.test(text) || text === '\x04' && !edited) {
      awaitingPrompt = true
      edited = false
      releasePrompt()
    } else if (!controlCharacter.test(text) || !paste && lineEditingInput.test(text)) {
      edited = true
    } else {
      releasePrompt()
    }
  }

  /** Encodes a history selection for Bash's Readline binding.
   * @param entry The visible entry selected by the user.
   * @returns Input bytes for the selection request, or undefined if the entry cannot be selected.
   */
  function select(entry: TerminalHistoryEntry): string | undefined {
    if (!prompt || awaitingPrompt || !view?.matches.includes(entry) || !canInsertTerminalHistory(entry)) return
    const request = ['10', ...entry.number, '11'].map(terminalHistoryKey).join('')
    edited = false
    publish('', 0)
    return request
  }

  const listeners = [terminal.parser.registerOscHandler(terminalHistoryOsc, handleFrame),
    terminal.onWriteParsed(refresh), terminal.onScroll(refresh), terminal.onResize(refresh)]

  /** Disposes xterm listeners and releases this session's cached history. */
  function dispose(): void {
    for (const listener of listeners) listener.dispose()
    reset()
  }

  return { setToken, reset, observeInput, select, dispose }
}
