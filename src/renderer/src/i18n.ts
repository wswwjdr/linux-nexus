import { i18n } from '@shared/i18n/messages'
import { useTranslation } from 'react-i18next'

export function useLanguage(): string {
  useTranslation(undefined, { i18n })
  return i18n.language
}
