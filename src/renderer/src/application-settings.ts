import { type SupportedLanguage, resolveLanguage } from '@shared/i18n/languages'
import { setLanguage } from '@shared/i18n/messages'
import type { AppBootstrap, AppSettings } from '@shared/types'

let system: SupportedLanguage

export function initializeApplication(bootstrap: AppBootstrap): void {
  system = bootstrap.systemLanguage
  applyApplicationLanguage(bootstrap.settings)
}

export function applyApplicationLanguage(settings: AppSettings): void {
  setLanguage(resolveLanguage(settings.language, system))
}
