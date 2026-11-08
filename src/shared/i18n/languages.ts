import en from './locales/en'
import zhCN from './locales/zh-CN'

export const languages = {
  'zh-CN': { name: '简体中文', formatLocale: 'zh-CN', resources: zhCN },
  en: { name: 'English', formatLocale: 'en-US', resources: en },
} as const

export type SupportedLanguage = keyof typeof languages
export type LanguagePreference = 'system' | SupportedLanguage

export function resolveSystemLanguage(preferred: readonly string[]): SupportedLanguage {
  const first = preferred[0] ?? 'en'
  const base = first.split('-')[0].toLowerCase()
  return (Object.keys(languages) as SupportedLanguage[]).find(language => language.split('-')[0].toLowerCase() === base) ?? 'en'
}

export function resolveLanguage(preference: LanguagePreference, system: SupportedLanguage): SupportedLanguage {
  return preference === 'system' ? system : preference
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || (typeof value === 'string' && Object.hasOwn(languages, value))
}
