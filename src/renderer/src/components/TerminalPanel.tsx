import { type MessageValue, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Clipboard, Copy } from 'lucide-react'
import type { TerminalOutputEvent } from '@shared/types'
import { errorMessage } from '@/app-utils'
import { ariaKeyShortcut, matchesShortcut, terminalShortcuts } from '@/keyboard-shortcuts'
import { readTerminalTheme } from '@/terminal-theme'
import { observeTerminalHistory, type TerminalHistoryView } from '@/terminal-history'
import type { TerminalHistoryEntry } from '@shared/terminal-history'
import { TerminalHistoryMenu } from './TerminalHistoryMenu'
import ContextMenuShortcut from './ContextMenuShortcut'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  sessionId: string
  active: boolean
  connected: boolean
  onError: (message: MessageValue) => void
}

/** Displays the SSH PTY and offers history matches when a Bash prompt is active.
 * @param props Session identifier, tab and connection state, and error callback.
 * @returns The terminal, its history popup, and its context menu.
 */
export default function TerminalPanel({ sessionId, active, connected, onError }: TerminalPanelProps) {
  const language = useLanguage()
  const hostRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const historyRef = useRef<ReturnType<typeof observeTerminalHistory> | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectedRef = useRef(connected)
  const [historyView, setHistoryView] = useState<TerminalHistoryView | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  connectedRef.current = connected

  useEffect(() => {
    if (!connected) historyRef.current?.reset()
  }, [connected])

  /** Sends terminal input to the current SSH session and reports a failed write.
   * @param data Input bytes encoded for the SSH terminal channel.
   */
  const sendInput = useCallback((data: string): void => {
    if (!connectedRef.current) return
    void window.remoteFiles.writeTerminal(sessionId, data).catch((error: unknown) => {
      if (connectedRef.current) onError(errorMessage(error))
    })
  }, [sessionId, onError])

  /** Applies a visible Bash history entry and restores focus to the interactive input.
   * @param entry The history entry selected in this tab's popup.
   */
  function selectHistory(entry: TerminalHistoryEntry): void {
    if (!active || !connected) return
    const data = historyRef.current?.select(entry)
    if (!data) return
    sendInput(data)
    terminalRef.current?.focus()
  }

  useEffect(() => {
    if (!contextMenu) return

    const dismissOutside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(null)
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setContextMenu(null)
      terminalRef.current?.focus()
    }
    const dismiss = () => setContextMenu(null)

    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('keydown', dismissOnEscape)
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    contextMenuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('keydown', dismissOnEscape)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [contextMenu])

  useLayoutEffect(() => {
    const menu = contextMenuRef.current
    if (!menu || !contextMenu) return
    const bounds = menu.getBoundingClientRect()
    const x = Math.max(8, Math.min(contextMenu.x, window.innerWidth - bounds.width - 8))
    const y = Math.max(8, Math.min(contextMenu.y, window.innerHeight - bounds.height - 8))
    if (x !== contextMenu.x || y !== contextMenu.y) setContextMenu({ x, y })
  }, [contextMenu, language])

  /**
   * Opens the clipboard menu at the pointer, with layout measuring its final viewport position.
   * @param event Right-click event from the terminal.
   */
  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  /** Copies the terminal selection to the clipboard and restores terminal focus. */
  const copySelection = useCallback(() => {
    const terminal = terminalRef.current
    const selection = terminal?.getSelection()
    if (!terminal || !selection) return
    void navigator.clipboard.writeText(selection).catch((error: unknown) => {
      onError(errorMessage(error))
    })
    setContextMenu(null)
    terminal.focus()
  }, [onError])

  /**
   * Pastes clipboard text into the connected terminal.
   * @returns A promise that settles after the paste or error reporting.
   */
  const pasteClipboard = useCallback(async () => {
    const terminal = terminalRef.current
    if (!terminal || !connectedRef.current) return
    try {
      const text = await navigator.clipboard.readText()
      if (terminalRef.current !== terminal || !connectedRef.current) return
      terminal.paste(text)
      setContextMenu(null)
      terminal.focus()
    } catch (error) {
      setContextMenu(null)
      terminal.focus()
      onError(errorMessage(error))
    }
  }, [onError])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: readTerminalTheme(host),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    const history = observeTerminalHistory(terminal, setHistoryView)
    historyRef.current = history

    const input = terminal.onData((data) => {
      if (!connectedRef.current) return
      history.observeInput(data)
      sendInput(data)
    })
    const removeOutput = window.remoteFiles.onTerminalOutput((output: TerminalOutputEvent) => {
      if (output.sessionId !== sessionId) return
      history.setToken(output.historyToken)
      terminal.write(output.data)
    })
    /**
     * Handles clipboard commands inside xterm and passes through other input.
     * @param event Keyboard event reported by xterm.
     * @returns Whether xterm should process the event.
     */
    const handleClipboardShortcut = (event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') return true
      if (matchesShortcut(event, terminalShortcuts.copy)) {
        event.preventDefault()
        copySelection()
        return false
      }
      if (matchesShortcut(event, terminalShortcuts.paste)) {
        // The clipboard callback owns the paste so Chromium does not also dispatch a native paste event.
        event.preventDefault()
        void pasteClipboard()
        return false
      }
      return true
    }
    terminal.attachCustomKeyEventHandler(handleClipboardShortcut)

    return () => {
      input.dispose()
      removeOutput()
      history.dispose()
      terminal.dispose()
      terminalRef.current = null
      historyRef.current = null
      fitRef.current = null
    }
  }, [sessionId, sendInput, copySelection, pasteClipboard])

  useEffect(() => {
    const host = hostRef.current
    const fit = fitRef.current
    if (!host || !fit || !active || !connected) return
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return
      fit.fit()
      const terminal = terminalRef.current
      if (!terminal) return
      void window.remoteFiles.resizeTerminal(sessionId, terminal.cols, terminal.rows).catch((error: unknown) => {
        onError(errorMessage(error))
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    terminalRef.current?.focus()
    return () => observer.disconnect()
  }, [active, connected, sessionId, onError])

  const screen = terminalRef.current?.element?.querySelector<HTMLElement>('.xterm-screen')
  const hostHeight = hostRef.current?.clientHeight ?? 0
  const rowHeight = screen && terminalRef.current ? screen.clientHeight / terminalRef.current.rows : 0
  const screenTop = screen && hostRef.current ? screen.getBoundingClientRect().top - hostRef.current.getBoundingClientRect().top : 0
  const historyRow = screenTop + (historyView?.row ?? 0) * rowHeight
  const historyStyle = historyRow > hostHeight / 2 ? { bottom: hostHeight - historyRow + 4 } : { top: historyRow + rowHeight + 4 }

  return (
    <div className="terminal-host" onContextMenu={openContextMenu}>
      <div className="terminal-screen" ref={hostRef} />
      {active && connected && !contextMenu && historyView && rowHeight > 0 && <TerminalHistoryMenu
        view={historyView} style={historyStyle} onSelect={selectHistory} />}
      {contextMenu && (
        <div
          className="browser-context-menu terminal-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label={tr('connections.terminalActions')}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button className="entry-context-action" role="menuitem" aria-keyshortcuts={ariaKeyShortcut(terminalShortcuts.copy)} disabled={!terminalRef.current?.hasSelection()} onClick={copySelection}>
            <Copy size={16} />
            <span className="context-menu-label">{tr('common.copy')}</span>
            <ContextMenuShortcut shortcut={terminalShortcuts.copy} />
          </button>
          <button className="entry-context-action" role="menuitem" aria-keyshortcuts={ariaKeyShortcut(terminalShortcuts.paste)} disabled={!connected} onClick={pasteClipboard}>
            <Clipboard size={16} />
            <span className="context-menu-label">{tr('connections.paste')}</span>
            <ContextMenuShortcut shortcut={terminalShortcuts.paste} />
          </button>
        </div>
      )}
    </div>
  )
}
