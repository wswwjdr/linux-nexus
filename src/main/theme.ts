import { nativeTheme } from 'electron'
import type { ThemeMode } from '@shared/types'
import { getMainWindow } from './runtime'

let currentTheme: ThemeMode = 'light'
const backgrounds: Record<ThemeMode, string> = {
  light: '#f2f2f2',
  dark: '#111111',
  cream: '#f6f1e7',
}

export function themeBackgroundColor(): string {
  return backgrounds[currentTheme]
}

export function applyTheme(theme: ThemeMode): void {
  currentTheme = theme
  nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
  getMainWindow()?.setBackgroundColor(themeBackgroundColor())
}
