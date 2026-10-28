import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveBaseName, archiveFormatForName } from '../src/shared/archive.ts'

test('recognizes supported archive suffixes case-insensitively', () => {
  assert.equal(archiveFormatForName('backup.ZIP'), 'zip')
  assert.equal(archiveFormatForName('release.tar.gz'), 'tar-gz')
  assert.equal(archiveFormatForName('release.TGZ'), 'tar-gz')
  assert.equal(archiveFormatForName('release.tar.bz2'), 'tar-bz2')
  assert.equal(archiveFormatForName('release.tbz2'), 'tar-bz2')
  assert.equal(archiveFormatForName('release.tar.xz'), 'tar-xz')
  assert.equal(archiveFormatForName('release.txz'), 'tar-xz')
  assert.equal(archiveFormatForName('release.tar.zst'), 'tar-zst')
  assert.equal(archiveFormatForName('release.tzst'), 'tar-zst')
  assert.equal(archiveFormatForName('release.tar'), 'tar')
  assert.equal(archiveFormatForName('notes.gz'), null)
  assert.equal(archiveFormatForName('installer.rar'), null)
})

test('derives an extraction directory without the full archive suffix', () => {
  assert.equal(archiveBaseName('release.tar.gz'), 'release')
  assert.equal(archiveBaseName('release.TGZ'), 'release')
  assert.equal(archiveBaseName('.zip'), 'extracted')
})

