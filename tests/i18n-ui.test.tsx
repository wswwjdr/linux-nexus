import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act, createElement, useEffect } from 'react'
import { JSDOM } from 'jsdom'
import { defaultAppSettings } from '../src/shared/app-settings'
import { initializeApplication } from '../src/renderer/src/application-settings'
import { useProfileManagement } from '../src/renderer/src/hooks/useProfileManagement'
import { useLanguage } from '../src/renderer/src/i18n'
import GlobalToast from '../src/renderer/src/GlobalToast'
import { msg, tr } from '../src/shared/i18n/messages'
import type { AppSettings, AppSettingsPatch, RemoteFilesApi } from '../src/shared/types'

test('language saves update open UI and historical notices without remounting workflows; failed saves roll back', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' })
  Object.defineProperties(globalThis, {
    React: { configurable: true, value: React },
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  let settings: AppSettings = { ...defaultAppSettings(), language: 'zh-CN' }
  const initialSettings = settings
  initializeApplication({ settings, systemLanguage: 'en' })
  let rejectSave = false, settingsReads = 0, mounts = 0, cleanups = 0
  window.remoteFiles = {
    listProfiles: async () => [],
    getAppSettings: async () => { settingsReads++; return settings },
    updateAppSettings: async (patch: AppSettingsPatch) => {
      if (rejectSave) throw new Error('disk write failed')
      settings = { ...settings, ...patch }
      return settings
    },
  } as unknown as RemoteFilesApi
  let management!: ReturnType<typeof useProfileManagement>
  const notices = [{ id: 1, kind: 'error' as const, message: msg('errors.connectionFailed') }]
  const noop = () => {}
  function Fixture() {
    useLanguage()
    management = useProfileManagement({ initialSettings, showToast: noop, onProfileSaved: noop, onProfileDeleted: noop,
      onDefaultViewChange: noop, onFileTypeExtensionsChange: noop, onPerformanceThresholdsChange: noop })
    useEffect(() => { mounts++; return () => { cleanups++ } }, [])
    return <><h1>{tr('settings.applicationSettings')}</h1><GlobalToast notices={notices} onDismiss={noop} /></>
  }
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(document.getElementById('root')!)
  try {
    await act(async () => root.render(createElement(Fixture)))
    assert.equal(settingsReads, 0, 'bootstrap settings must be reused')
    await act(async () => management.openSettingsDialog())
    await act(async () => management.updateLanguage('en'))
    assert.equal(document.documentElement.lang, 'en')
    assert.equal(document.querySelector('h1')!.textContent, 'Application settings')
    assert.equal(document.querySelector('[role=alert] .global-toast-message')!.textContent, 'Connection failed')
    assert.equal(settings.language, 'en')
    rejectSave = true
    await act(async () => management.updateLanguage('zh-CN'))
    assert.equal(document.documentElement.lang, 'en')
    assert.equal(management.settingsForm!.language, 'en')
    assert.equal(mounts, 1)
    assert.equal(cleanups, 0)
    rejectSave = false
    await act(async () => management.updateLanguage('system'))
    assert.equal(document.documentElement.lang, 'en')
    await act(async () => initializeApplication({ settings, systemLanguage: 'zh-CN' }))
    assert.equal(document.documentElement.lang, 'zh-CN')
  } finally {
    await act(async () => root.unmount())
    dom.window.close()
  }
})
