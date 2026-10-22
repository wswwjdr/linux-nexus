import assert from 'node:assert/strict'
import test from 'node:test'
import type { FileTypeExtensions } from '../src/shared/types.ts'
import { DEFAULT_APP_SETTINGS, DEFAULT_PERFORMANCE_THRESHOLDS, validateAppSettings } from '../src/shared/app-settings.ts'
import { validateExternalUrl } from '../src/shared/external-url.ts'
import { previewMimeType } from '../src/shared/preview-mime-type.ts'
import { DEFAULT_FILE_TYPE_EXTENSIONS, normalizeFileTypeExtension, classifyFileTypeCategories } from '../src/shared/file-type-categories.ts'

function copyDefaultExtensions(): FileTypeExtensions {
  return Object.fromEntries(Object.entries(DEFAULT_FILE_TYPE_EXTENSIONS).map(([type, extensions]) => [type, [...extensions]])) as FileTypeExtensions
}

test('normalizes extensions and matches overlapping and multi-part suffixes', () => {
  assert.equal(normalizeFileTypeExtension('  .TaR.GZ '), '.tar.gz')
  assert.deepEqual(classifyFileTypeCategories('/var/log/REPORT.MD', copyDefaultExtensions()), ['text', 'markdown'])
  assert.deepEqual(classifyFileTypeCategories('/home/user/run.sh', copyDefaultExtensions()), ['text', 'script'])
  assert.deepEqual(classifyFileTypeCategories('/home/user/job.py', copyDefaultExtensions()), ['text', 'script'])
  const extensions = copyDefaultExtensions()
  extensions.pdf.push('tar.gz')
  assert.deepEqual(classifyFileTypeCategories('/archive/backup.TAR.GZ', extensions), ['pdf'])
  assert.deepEqual(classifyFileTypeCategories('/home/user/.profile', extensions), [])
  assert.throws(() => normalizeFileTypeExtension('../secret'))
})

test('defaults script category to selected extensions and requires it in settings', () => {
  assert.deepEqual(DEFAULT_FILE_TYPE_EXTENSIONS.script, ['sh', 'bash', 'zsh', 'py'])
  const fileTypeExtensions = copyDefaultExtensions() as Partial<FileTypeExtensions>
  delete fileTypeExtensions.script
  assert.throws(() => validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    fileTypeExtensions,
  }))
})

test('validates file type extension sets, deduplicates within a category, and keeps overlaps', () => {
  const fileTypeExtensions = copyDefaultExtensions()
  fileTypeExtensions.text.push('TXT', '.txt')
  const settings = validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    fileTypeExtensions,
  })

  assert.equal(settings.fileTypeExtensions.text.filter((extension) => extension === '.txt').length, 1)
  assert.ok(settings.fileTypeExtensions.text.includes('.md'))
  assert.ok(settings.fileTypeExtensions.markdown.includes('.md'))
  assert.throws(() => validateAppSettings({
    ...DEFAULT_APP_SETTINGS,
    fileTypeExtensions: { ...copyDefaultExtensions(), pdf: ['../outside'] },
  }))
})

test('defaults to light theme and validates all supported theme modes', () => {
  assert.equal(DEFAULT_APP_SETTINGS.theme, 'light')
  for (const theme of ['light', 'dark', 'system'] as const) {
    assert.equal(validateAppSettings({ ...DEFAULT_APP_SETTINGS, theme }).theme, theme)
  }
  assert.throws(() => validateAppSettings({ ...DEFAULT_APP_SETTINGS, theme: 'auto' }))
})

test('requires a complete settings structure with performance thresholds', () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS.performanceThresholds, DEFAULT_PERFORMANCE_THRESHOLDS)
  const incomplete = { ...DEFAULT_APP_SETTINGS } as Record<string, unknown>
  delete incomplete.performanceThresholds
  assert.throws(() => validateAppSettings(incomplete))
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
