import type { BrowserWindow } from 'electron'

export function isWindowExpanded(window: BrowserWindow): boolean {
  return window.isMaximized() || window.isFullScreen()
}

export function publishWindowLayoutChanges(window: BrowserWindow): void {
  const publish = () => window.webContents.send('app:window-expanded', isWindowExpanded(window))
  window.on('maximize', publish)
  window.on('unmaximize', publish)
  window.on('enter-full-screen', publish)
  window.on('leave-full-screen', publish)
}
