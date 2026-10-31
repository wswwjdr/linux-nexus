import { nativeTheme } from 'electron'
import type { ThemeMode } from '@shared/types'
import { getMainWindow } from './runtime'

export function themeBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#111111' : '#f2f2f2'
}

function updateWindowBackground(): void {
  getMainWindow()?.setBackgroundColor(themeBackgroundColor())
}

nativeTheme.on('updated', updateWindowBackground)

export function applyTheme(theme: ThemeMode): void {
  nativeTheme.themeSource = theme
  updateWindowBackground()
}
