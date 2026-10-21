import assert from 'node:assert/strict'
import test from 'node:test'
import type { PreviewExtensions } from '../src/shared/types.ts'
import { DEFAULT_APP_SETTINGS, migrateAppSettings, validateAppSettings } from '../src/shared/app-settings.ts'
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

test('migrates old settings with defaults while preserving user values', () => {
  const { settings, migrated } = migrateAppSettings({
    textMiB: 23,
    imageMiB: 87,
    audioMiB: 42,
    videoMiB: 512,
    startupConnection: { profileId: 'server-1', kind: 'sftp' },
    transferFileConcurrency: 6,
  })

  assert.equal(migrated, true)
  assert.equal(settings.textMiB, 23)
  assert.equal(settings.imageMiB, 87)
  assert.equal(settings.audioMiB, 42)
  assert.equal(settings.videoMiB, 512)
  assert.equal(settings.transferFileConcurrency, 6)
  assert.deepEqual(settings.startupConnection, { profileId: 'server-1', kind: 'sftp' })
  assert.equal(settings.pdfMiB, 100)
  assert.ok(settings.previewExtensions.pdf.includes('.pdf'))
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
