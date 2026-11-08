import { createInstance } from 'i18next'
import en from './locales/en'
import { languages, type SupportedLanguage } from './languages'

type Resources = typeof en
export type MessageKey = { [D in keyof Resources]: `${D}.${keyof Resources[D] & string}` }[keyof Resources]
type Text<K extends MessageKey> = K extends `${infer D extends keyof Resources}.${infer N}`
  ? N extends keyof Resources[D] ? Resources[D][N] : never : never
type VariableName<V extends string> = V extends `${infer Name},${string}` ? Name : V
type Variables<S> = S extends `${string}{{${infer V}}}${infer Rest}` ? VariableName<V> | Variables<Rest> : never
export type MessageValue = string | LocalizedMessage
export interface LocalizedMessage {
  key: MessageKey
  params?: Record<string, MessageValue | number | boolean | null>
  detail?: string
}
type Arguments<K extends MessageKey> = [Variables<Text<K>>] extends [never]
  ? [params?: Record<string, MessageValue | number | boolean | null>]
  : [params: Record<Variables<Text<K>>, MessageValue | number | boolean | null>]

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: Resources }
    strictKeyChecks: true
    returnNull: false
  }
}

export const i18n = createInstance()
void i18n.init({
  lng: 'en', fallbackLng: false, initAsync: false,
  resources: Object.fromEntries(Object.entries(languages).map(([id, language]) => [id, { translation: language.resources }])),
  interpolation: { escapeValue: false },
  returnNull: false, returnEmptyString: false,
  parseMissingKeyHandler: (key) => { throw new Error(`Missing translation: ${key}`) },
})

export function msg<K extends MessageKey>(key: K, ...[params]: Arguments<K>): LocalizedMessage {
  return params ? { key, params } : { key }
}

export function renderMessage(value: MessageValue | null | undefined): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  const params = Object.fromEntries(Object.entries(value.params ?? {}).map(([name, item]) => [name,
    item !== null && typeof item === 'object' ? renderMessage(item) : item,
  ]))
  // Descriptors are typed at creation; recursive parameters are resolved here.
  const translate = i18n.t as unknown as (key: MessageKey, params: Record<string, unknown>) => string
  const text = translate(value.key, params)
  return value.detail ? `${text}: ${value.detail}` : text
}

export function tr<K extends MessageKey>(key: K, ...args: Arguments<K>): string {
  return renderMessage(msg(key, ...args))
}

export function setLanguage(language: SupportedLanguage): void {
  void i18n.changeLanguage(language)
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

export function formatLocale(): string {
  return languages[i18n.language as SupportedLanguage].formatLocale
}

export class LocalizedError extends Error {
  readonly localizedMessage: MessageValue
  constructor(message: MessageValue, options?: ErrorOptions) {
    const descriptor = typeof message === 'string' ? diagnosticMessage(message) : message
    super(renderMessage(descriptor), options)
    this.localizedMessage = descriptor
    this.name = 'LocalizedError'
  }
}

export function messageFromUnknown(error: unknown): MessageValue {
  if (error instanceof LocalizedError) return error.localizedMessage
  if (error == null) return msg('common.operationFailedTryAgain')
  return diagnosticMessage(error instanceof Error ? error.message : String(error))
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: MessageValue }

const diagnosticKeys: Record<string, MessageKey> = {
  "aliasSymlink": "errors.remoteAliasSymlink",
  "aliasNotRegular": "errors.remoteAliasNotRegular",
  "aliasExists": "errors.remoteAliasExists",
  "aliasChanged": "errors.remoteAliasChanged",
  "deleteType": "errors.remoteDeleteType",
  "diskUsageType": "errors.remoteDiskUsageType",
  "searchDirectory": "errors.remoteSearchDirectory",
  "distribution": "errors.remoteDistribution",
  "unsupportedDistribution": "errors.remoteUnsupportedDistribution",
  "missingCommand": "errors.remoteMissingCommand",
  "gnuFind": "errors.remoteGnuFind",
  "gnuCore": "errors.remoteGnuCore",
  "gnuGrep": "errors.remoteGnuGrep",
  "gnuTar": "errors.remoteGnuTar",
  "copyType": "errors.remoteCopyType",
  "targetDirectory": "errors.remoteTargetDirectory",
  "sourceType": "errors.remoteSourceType",
  "moveMissing": "errors.remoteMoveMissing",
  "renameType": "errors.remoteRenameType",
  "nameExists": "errors.remoteNameExists",
  "renameIncomplete": "errors.remoteRenameIncomplete",
  "packageManager": "errors.remotePackageManager",
  "installSudo": "errors.remoteInstallSudo",
  "incompleteBytes": "errors.remoteIncompleteBytes",
  "invalidCommit": "errors.remoteInvalidCommit",
  "hardlinkType": "errors.remoteHardlinkType",
  "preserveMetadata": "errors.remotePreserveMetadata",
  "readChanged": "errors.remoteReadChanged"
}

export function diagnosticMessage(text: string): MessageValue {
  const match = /LINUX_NEXUS_DIAGNOSTIC:([a-zA-Z]+)([^\r\n]*)/.exec(text)
  if (!match || !Object.hasOwn(diagnosticKeys, match[1])) return text
  const message: LocalizedMessage = { key: diagnosticKeys[match[1]] }
  const detail = match[2].replace(/^[\s:：]+/, '')
  if (detail) message.detail = detail
  const before = text.slice(0, match.index)
  const after = diagnosticMessage(text.slice(match.index + match[0].length))
  return before || after ? msg('common.joinedMessage', { before, message, after }) : message
}
