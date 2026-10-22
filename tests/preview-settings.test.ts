import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewExtensions } from '../src/shared/types.ts'
import { DEFAULT_APP_SETTINGS, DEFAULT_PERFORMANCE_THRESHOLDS, upgradeAppSettings, validateAppSettings } from '../src/shared/app-settings.ts'
import { validateExternalUrl } from '../src/shared/external-url.ts'
import { previewMimeType } from '../src/shared/preview-mime-type.ts'
import { DEFAULT_PREVIEW_EXTENSIONS, normalizePreviewExtension, previewFileTypes } from '../src/shared/preview-file-type.ts'

function copyDefaultExtensions(): PreviewExtensions {
  return Object.fromEntries(Object.entries(DEFAULT_PREVIEW_EXTENSIONS).map(([type, extensions]) => [type, [...extensions]])) as PreviewExtensions
}

test('normalizes extensions and matches overlapping and multi-part suffixes', () => {
  assert.equal(normalizePreviewExtension('  .TaR.GZ '), '.tar.gz')
  assert.deepEqual(previewFileTypes('/var/log/REPORT.MD', copyDefaultExtensions()), ['text', 'markdown'])
  const extensions = copyDefaultExtensions()
  extensions.pdf.push('tar.gz')
  assert.deepEqual(previewFileTypes('/archive/backup.TAR.GZ', extensions), ['pdf'])
  assert.deepEqual(previewFileTypes('/home/user/.profile', extensions), [])
  assert.throws(() => normalizePreviewExtension('../secret'))
})

test('validates preview extension sets, deduplicates within a category, and keeps overlaps', () => {
  const previewExtensions = copyDefaultExtensions()
  previewExtensions.text.push('TXT', '.txt')
  const settings = validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    previewExtensions,
  })

  assert.equal(settings.previewExtensions.text.filter((extension) => extension === '.txt').length, 1)
  assert.ok(settings.previewExtensions.text.includes('.md'))
  assert.ok(settings.previewExtensions.markdown.includes('.md'))
  assert.throws(() => validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    previewExtensions: { ...copyDefaultExtensions(), pdf: ['../outside'] },
  }))
})

test('defaults to light theme and validates all supported theme modes', () => {
  assert.equal(DEFAULT_APP_SETTINGS.theme, 'light')
  for (const theme of ['light', 'dark', 'system'] as const) {
    assert.equal(validateAppSettings({ ...DEFAULT_APP_SETTINGS, theme }).theme, theme)
  }
  assert.throws(() => validateAppSettings({ ...DEFAULT_APP_SETTINGS, theme: 'auto' }))
})

test('defaults and migrates performance thresholds for existing settings', () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS.performanceThresholds, DEFAULT_PERFORMANCE_THRESHOLDS)
  const legacy = { ...DEFAULT_APP_SETTINGS } as Record<string, unknown>
  delete legacy.performanceThresholds
  const migrated = upgradeAppSettings(legacy)
  assert.equal(migrated.migrated, true)
  assert.deepEqual(migrated.settings.performanceThresholds, DEFAULT_PERFORMANCE_THRESHOLDS)
  assert.equal(upgradeAppSettings(DEFAULT_APP_SETTINGS).migrated, false)
})

test('rejects invalid performance threshold pairs and values', () => {
  assert.throws(() => validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    performanceThresholds: {
      ...DEFAULT_PERFORMANCE_THRESHOLDS,
      cpu: { warning: 90, critical: 90 },
    },
  }))
  assert.throws(() => validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    performanceThresholds: {
      ...DEFAULT_PERFORMANCE_THRESHOLDS,
      disk: { warning: 75, critical: 101 },
    },
  }))
})

test('selects MIME types from the chosen preview category and known extensions', () => {
  assert.equal(previewMimeType('pdf', 'report.custom'), 'application/pdf')
  assert.equal(previewMimeType('pdf', 'report.jpg'), 'application/pdf')
  assert.equal(previewMimeType('audio', 'voice.opus'), 'audio/ogg')
  assert.equal(previewMimeType('video', 'capture.ogg'), 'video/ogg')
  assert.equal(previewMimeType('audio', 'capture.webm'), 'audio/webm')
  assert.equal(previewMimeType('video', 'clip.webm'), 'video/webm')
  assert.equal(previewMimeType('image', 'icon.svg'), 'image/svg+xml')
  assert.equal(previewMimeType('text', 'icon.svg'), 'text/plain; charset=utf-8')
})

test('allows only credential-free HTTP and HTTPS external links', () => {
  assert.equal(validateExternalUrl('https://example.com/docs?q=1'), 'https://example.com/docs?q=1')
  assert.equal(validateExternalUrl('http://example.com'), 'http://example.com/')
  assert.throws(() => validateExternalUrl('javascript:alert(1)'))
  assert.throws(() => validateExternalUrl('file:///etc/passwd'))
  assert.throws(() => validateExternalUrl('https://user:pass@example.com'))
})
