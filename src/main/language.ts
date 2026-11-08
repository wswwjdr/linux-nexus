import { type LanguagePreference, type SupportedLanguage, resolveLanguage, resolveSystemLanguage } from '../shared/i18n/languages'
import { setLanguage } from '../shared/i18n/messages'
import { app } from 'electron'

let startupSystemLanguage: SupportedLanguage | undefined

export function systemLanguage(): SupportedLanguage {
  // Resolve once per launch so native dialogs and the renderer share one value.
  return startupSystemLanguage ??= resolveSystemLanguage(app.getPreferredSystemLanguages())
}

export function applyLanguage(preference: LanguagePreference): void {
  setLanguage(resolveLanguage(preference, systemLanguage()))
}
