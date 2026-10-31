import type { ITheme } from '@xterm/xterm'

/** SSH has one fixed palette, shared with its surrounding CSS surfaces. */
export function readTerminalTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element)
  const color = (name: string) => style.getPropertyValue(`--terminal-${name}`).trim()
  return {
    background: color('background'),
    foreground: color('foreground'),
    cursor: color('cursor'),
    cursorAccent: color('cursor-accent'),
    selectionBackground: color('selection-background'),
    selectionForeground: color('selection-foreground'),
    black: color('black'),
    red: color('red'),
    green: color('green'),
    yellow: color('yellow'),
    blue: color('blue'),
    magenta: color('magenta'),
    cyan: color('cyan'),
    white: color('white'),
    brightBlack: color('bright-black'),
    brightRed: color('bright-red'),
    brightGreen: color('bright-green'),
    brightYellow: color('bright-yellow'),
    brightBlue: color('bright-blue'),
    brightMagenta: color('bright-magenta'),
    brightCyan: color('bright-cyan'),
    brightWhite: color('bright-white'),
  }
}
