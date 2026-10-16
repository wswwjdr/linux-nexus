import { useEffect, useRef } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
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
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const connectedRef = useRef(connected)
  connectedRef.current = connected

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

  return <div className="terminal-host" ref={hostRef} />
}
