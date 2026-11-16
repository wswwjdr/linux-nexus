import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareReleaseVersions, createReleaseTag, parseReleaseTag } from '../src/shared/release-version.mts'
import { releaseSignaturePayload, verifyInstaller, verifyReleaseSignature } from '../src/main/update-signature.mts'

test('release tags use Beijing time and compare correctly across date and major version boundaries', () => {
  const tag = createReleaseTag('1', new Date('2026-11-16T06:35:54Z'))
  assert.equal(tag, 'v1.202611161435')
  assert.equal(tag, createReleaseTag('1', new Date('2026-11-16T06:35:00Z')))
  assert.equal(parseReleaseTag(tag).version, '1.24322.22475')
  const tags = [
    'v1.202611162358', 'v1.202611162359', 'v1.202611170000',
    'v1.202611302359', 'v1.202612010000', 'v1.202612312359', 'v1.202701010000', 'v2.202701010000',
  ]
  const versions = tags.map(value => parseReleaseTag(value).version)
  assert(compareReleaseVersions(versions[0], '1.0.0') > 0)
  assert.equal(compareReleaseVersions(versions[0], versions[0]), 0)
  for (let i = 1; i < versions.length; i++) {
    assert(compareReleaseVersions(versions[i], versions[i - 1]) > 0)
    assert(compareReleaseVersions(versions[i - 1], versions[i]) < 0)
  }
})

test('impossible dates and out-of-range Windows version fields are rejected', () => {
  for (const tag of ['v1.202602291200', 'v1.202611312359', 'v1.202611162400', 'v1.202611161460',
    'v1.202613010000', 'v01.202611161435', 'v65536.202611161435', 'v1.600011161435']) {
    assert.throws(() => parseReleaseTag(tag), /Invalid release tag/)
  }
  assert.equal(parseReleaseTag('v65535.202402290000').displayVersion, '65535.202402290000')
})

test('release signature binds the tag, version, installer path and hash', async t => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const tag = 'v1.202611161435'
  const filename = 'Linux-Nexus-Setup-1.202611161435.exe'
  const installer = Buffer.from('test installer')
  const sha512 = createHash('sha512').update(installer).digest('base64')
  const info = { version: '1.24322.22475', path: filename, sha512, files: [{ url: filename, sha512 }] }
  const signature = sign(null, releaseSignaturePayload(tag, info).payload, privateKey)
  assert.equal(verifyReleaseSignature(tag, info, signature, publicKey).filename, filename)
  assert.throws(() => verifyReleaseSignature(tag, info, Buffer.alloc(0), publicKey), /signature/)
  assert.throws(() => verifyReleaseSignature(tag, info, Buffer.alloc(64), publicKey), /signature/)
  assert.throws(() => verifyReleaseSignature('v1.202611161436', info, signature, publicKey), /metadata/)
  assert.throws(() => verifyReleaseSignature(tag, { ...info, packages: {} }, signature, publicKey), /metadata/)
  assert.throws(() => verifyReleaseSignature(tag, { ...info, path: 'https://example.com/file.exe' }, signature, publicKey), /metadata/)
  const forgedHash = Buffer.alloc(64).toString('base64')
  assert.throws(() => verifyReleaseSignature(tag, {
    ...info,
    sha512: forgedHash,
    files: [{ url: filename, sha512: forgedHash }],
  }, signature, publicKey), /signature/)

  const directory = await mkdtemp(join(tmpdir(), 'linux-nexus-release-test-'))
  t.after(() => rm(directory, { recursive: true }))
  const path = join(directory, filename)
  await writeFile(path, installer)
  await verifyInstaller(path, sha512)
  await writeFile(path, 'altered installer')
  await assert.rejects(verifyInstaller(path, sha512), /SHA-512/)
  await assert.rejects(verifyInstaller(join(directory, 'missing.exe'), sha512), { code: 'ENOENT' })
})
