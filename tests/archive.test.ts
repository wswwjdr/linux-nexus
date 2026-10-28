import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveBaseName, archiveFormatForName } from '../src/shared/archive.ts'
import { buildArchivePreparationCommand } from '../src/main/archives.ts'

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

test('builds a private remote extraction command with shell-quoted paths', () => {
  const command = buildArchivePreparationCommand(
    'zip',
    "/srv/releases/odd name's.zip",
    "/srv/releases/.linux-nexus-extract-task-id",
  )

  assert.match(command, /python3 -c/)
  assert.doesNotMatch(command, /' -- 'zip'/)
  assert.match(command, /umask 077/)
  assert.match(command, /stage='\/srv\/releases\/\.linux-nexus-extract-task-id'/)
  assert.match(command, /trap cleanup 0/)
  assert.match(command, /cancel='\/srv\/releases\/\.linux-nexus-extract-task-id\.cancel'/)
  assert.match(command, /rm -f -- "\$cancel"/)
  assert.match(command, /trap 'exit 129' HUP/)
  assert.match(command, /odd name'\\''s\.zip/)
  assert.match(command, /路径穿越条目/)
  assert.match(command, /name = name\.replace/)
  assert.match(command, /归档包含绝对路径：/)
  assert.match(command, /def zip_is_directory\(info, mode\):/)
  assert.match(command, /info\.filename\.endswith/)
  assert.match(command, /info\.external_attr & 0x10/)
  assert.match(command, /符号链接、硬链接或特殊文件/)
  assert.match(command, /不支持加密 ZIP 条目/)
})
