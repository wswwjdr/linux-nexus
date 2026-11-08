import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultAppSettings, validateAppSettings } from '../src/shared/app-settings'
import { languages, resolveLanguage, resolveSystemLanguage } from '../src/shared/i18n/languages'
import { diagnosticMessage, i18n, LocalizedError, messageFromUnknown, msg, renderMessage, setLanguage, tr } from '../src/shared/i18n/messages'
import { createRemoteFilesApi } from '../src/renderer/src/remote-files-api'
import { formatDate, entryNameCollator } from '../src/renderer/src/app-utils'
import type { RemoteFilesTransport } from '../src/shared/types'

test('system language and explicit preferences have deterministic precedence', () => {
  for (const language of ['zh', 'zh-CN', 'zh-TW', 'ZH-hant']) assert.equal(resolveSystemLanguage([language]), 'zh-CN')
  for (const preferred of [[], ['en-GB'], ['ja-JP'], ['fr-FR', 'zh-CN']]) assert.equal(resolveSystemLanguage(preferred), 'en')
  assert.equal(resolveLanguage('system', 'zh-CN'), 'zh-CN')
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en')
  assert.equal(resolveLanguage('zh-CN', 'en'), 'zh-CN')
  assert.equal(defaultAppSettings().language, 'system')
  assert.throws(() => validateAppSettings({ ...defaultAppSettings(), language: 'fr' }))
  const { language: _language, ...oldSettings } = defaultAppSettings()
  assert.throws(() => validateAppSettings(oldSettings))
})

test('every shipped resource has matching keys and interpolation arguments', () => {
  const english = languages.en.resources
  const placeholders = (text: string) => [...text.matchAll(/{{([^}]+)}}/g)].map(match => match[1]).sort()
  for (const { resources } of Object.values(languages)) {
    assert.deepEqual(Object.keys(resources).sort(), Object.keys(english).sort())
    for (const namespace of Object.keys(english) as Array<keyof typeof english>) {
      assert.deepEqual(Object.keys(resources[namespace]).sort(), Object.keys(english[namespace]).sort())
      for (const [key, value] of Object.entries(english[namespace])) {
        const translated = (resources[namespace] as Record<string, string>)[key]
        assert.ok(translated.trim(), `${namespace}.${key}`)
        assert.deepEqual(placeholders(translated), placeholders(value), `${namespace}.${key}`)
      }
    }
  }
  for (const namespace of Object.values(english)) for (const value of Object.values(namespace)) assert.doesNotMatch(value, /\p{Script=Han}/u)
})

test('English plurals, nested descriptors and raw diagnostics follow the active language', () => {
  const notice = msg('files.completed', { label: msg('common.copy') })
  setLanguage('en')
  assert.equal(tr('files.downloadItems', { count: 1 }), 'Download 1 item')
  assert.equal(tr('files.downloadItems', { count: 2 }), 'Download 2 items')
  assert.equal(tr('files.downloadItems', { count: 1000 }), 'Download 1,000 items')
  assert.equal(renderMessage(notice), 'Copy completed')
  const diagnostic = diagnosticMessage('cp: Permission denied\nLINUX_NEXUS_DIAGNOSTIC:missingCommand: sha256sum\n')
  assert.equal(renderMessage(diagnostic), 'cp: Permission denied\nMissing server command: sha256sum\n')
  setLanguage('zh-CN')
  assert.equal(renderMessage(notice), '复制已完成')
  assert.match(renderMessage(diagnostic), /缺少服务器命令: sha256sum/)
  assert.equal(renderMessage('服务器原始日志'), '服务器原始日志')
  assert.throws(() => (i18n.t as (key: string) => string)('missing.translation'), /Missing translation/)
})

test('IPC envelopes retain descriptors across serialization and unwrap in the renderer', async () => {
  const message = msg('errors.remoteCommandFailedExitCode', { exitCode: 23 })
  const transport = {
    listProfiles: async () => structuredClone({ ok: false, error: message }),
    disconnect: async () => ({ ok: true, value: undefined }),
    onTerminalOutput: (callback: unknown) => callback,
  } as unknown as RemoteFilesTransport
  const api = createRemoteFilesApi(Object.freeze(transport))
  await assert.rejects(api.listProfiles(), error => {
    assert.ok(error instanceof LocalizedError)
    assert.deepEqual(messageFromUnknown(error), message)
    setLanguage('en')
    assert.equal(renderMessage(messageFromUnknown(error)), 'Remote command failed (exit code 23)')
    return true
  })
  assert.equal(await api.disconnect('session'), undefined)
  assert.equal(api.onTerminalOutput, transport.onTerminalOutput)
  setLanguage('zh-CN')
})

test('dates and filename ordering use the selected locale without changing timezone', () => {
  const value = '2026-11-08T05:06:00Z'
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  for (const language of ['en', 'zh-CN'] as const) {
    setLanguage(language)
    assert.equal(formatDate(value), new Intl.DateTimeFormat(languages[language].formatLocale, options).format(new Date(value)))
    assert.ok(entryNameCollator.compare('file2', 'file10') < 0)
  }
})

test('both READMEs keep working links and the same screenshot set', () => {
  const links = (file: string) => [...readFileSync(file, 'utf8').matchAll(/\]\(([^)]+)\)/g)].map(match => match[1])
  for (const file of ['README.md', 'README.en.md']) for (const target of links(file)) assert.ok(existsSync(resolve(target)), `${file}: ${target}`)
  const shots = (file: string) => links(file).filter(link => link.endsWith('.png')).sort()
  assert.deepEqual(shots('README.md'), shots('README.en.md'))
})
