import type { ThemeMode } from '@shared/types'

export function applyRendererTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')
    ?.setAttribute('content', theme === 'cream' ? '#f6f1e7' : '#f2f2f2')
}
