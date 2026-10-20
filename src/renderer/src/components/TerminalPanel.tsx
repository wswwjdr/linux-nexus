import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import { Clipboard, Copy } from 'lucide-react'
import type { TerminalOutputEvent } from '@shared/types'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  sessionId: string
  active: boolean
  connected: boolean
  onError: (message: string) => void
}

export default function TerminalPanel({ sessionId, active, connected, onError }: TerminalPanelProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectedRef = useRef(connected)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  connectedRef.current = connected

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

  const openContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const menuWidth = 204
    const menuHeight = 82
    const inset = 8
    setContextMenu({
      x: Math.max(inset, Math.min(event.clientX, window.innerWidth - menuWidth - inset)),
      y: Math.max(inset, Math.min(event.clientY, window.innerHeight - menuHeight - inset)),
    })
  }

  const copySelection = () => {
    const terminal = terminalRef.current
    const selection = terminal?.getSelection()
    if (!terminal || !selection) return
    void navigator.clipboard.writeText(selection).catch((error: unknown) => {
      onError(error instanceof Error ? error.message : String(error))
    })
    setContextMenu(null)
    terminal.focus()
  }

  const pasteClipboard = async () => {
    const terminal = terminalRef.current
    if (!terminal || !connectedRef.current) return
    try {
      const text = await navigator.clipboard.readText()
      terminal.paste(text)
      setContextMenu(null)
      terminal.focus()
    } catch (error) {
      setContextMenu(null)
      terminal.focus()
      onError(error instanceof Error ? error.message : String(error))
    }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Cascadia Code, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: {
        background: '#17211d',
        foreground: '#e1e9e3',
        cursor: '#9bd2b5',
        selectionBackground: '#466453',
        black: '#18211d',
        red: '#dc796d',
        green: '#7ac09a',
        yellow: '#dfbd74',
        blue: '#7aa5cc',
        magenta: '#c18bb8',
        cyan: '#75bcb9',
        white: '#dfe7e1',
        brightBlack: '#69776f',
        brightRed: '#ee968b',
        brightGreen: '#9bd2b5',
        brightYellow: '#f0d493',
        brightBlue: '#9dc1e3',
        brightMagenta: '#d9a6d0',
        brightCyan: '#91d1ce',
        brightWhite: '#ffffff',
      },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit

    const input = terminal.onData((data) => {
      if (!connectedRef.current) return
      void window.remoteFiles.writeTerminal(sessionId, data).catch((error: unknown) => {
        if (connectedRef.current) onError(error instanceof Error ? error.message : String(error))
      })
    })
    const removeOutput = window.remoteFiles.onTerminalOutput((output: TerminalOutputEvent) => {
      if (output.sessionId === sessionId) terminal.write(output.data)
    })
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true
      if (event.key.toLowerCase() === 'c') {
        if (terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection()).catch((error: unknown) => {
            onError(error instanceof Error ? error.message : String(error))
          })
        }
        return false
      }
      return true
    })

    return () => {
      input.dispose()
      removeOutput()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
    }
  }, [sessionId, onError])

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
        onError(error instanceof Error ? error.message : String(error))
      })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    terminalRef.current?.focus()
    return () => observer.disconnect()
  }, [active, connected, sessionId, onError])

  return (
    <div className="terminal-host" ref={hostRef} onContextMenu={openContextMenu}>
      {contextMenu && (
        <div
          className="browser-context-menu terminal-context-menu"
          ref={contextMenuRef}
          role="menu"
          aria-label="终端操作"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onContextMenu={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <button className="entry-context-action" role="menuitem" disabled={!terminalRef.current?.hasSelection()} onClick={copySelection}>
            <Copy size={16} /> 复制
          </button>
          <button className="entry-context-action" role="menuitem" disabled={!connected} onClick={() => void pasteClipboard()}>
            <Clipboard size={16} /> 粘贴
          </button>
        </div>
      )}
    </div>
  )
}
