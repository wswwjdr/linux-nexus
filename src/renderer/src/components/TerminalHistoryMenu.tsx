import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { tr } from '@shared/i18n/messages'
import type { TerminalHistoryEntry } from '@shared/terminal-history'
import { useVirtualRows } from '@/hooks/useVirtualRows'
import { canInsertTerminalHistory, type TerminalHistoryView } from '@/terminal-history'

interface TerminalHistoryMenuProps {
  view: TerminalHistoryView
  style: CSSProperties
  onSelect: (entry: TerminalHistoryEntry) => void
}

/** Renders matching history entries near the Bash prompt.
 * @param props The active matches, the popup position, and the selection callback.
 * @returns A scrollable list of command history matches.
 */
export function TerminalHistoryMenu({ view, style, onSelect }: TerminalHistoryMenuProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const rows = useVirtualRows(viewport, view.matches.length, 27)
  useLayoutEffect(() => { viewport.current!.scrollTop = 0 }, [view.input])

  return <div className="terminal-history-menu" style={style} ref={viewport} role="region"
    aria-label={tr('connections.terminalHistory')} onMouseDown={event => {
      if (event.target !== event.currentTarget) event.preventDefault()
    }}>
    <div aria-hidden="true" style={{ height: rows.before }} />
    {view.matches.slice(rows.first, rows.last).map(entry => canInsertTerminalHistory(entry) ? (
      <button key={entry.number} className="terminal-history-option" type="button" title={entry.command}
        onClick={() => onSelect(entry)}>{entry.command}</button>
    ) : (
      <div key={entry.number} className="terminal-history-option" title={entry.command}>
        {entry.command.replace(/\n/g, ' ↵ ')}
      </div>
    ))}
    <div aria-hidden="true" style={{ height: rows.after }} />
  </div>
}
