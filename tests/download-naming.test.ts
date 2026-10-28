import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { uniqueDownloadName } from '../src/main/transfers/download.ts'

test('chooses browser-style numbered names without replacing existing local files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linux-nexus-download-names-'))
  try {
    await writeFile(join(directory, 'report.tar.gz'), '')
    await writeFile(join(directory, 'report.tar (1).gz'), '')
    const reserved = new Set(['report.tar (2).gz'])
    assert.equal(await uniqueDownloadName(directory, 'report.tar.gz', reserved), 'report.tar (3).gz')
    assert.equal(await uniqueDownloadName(directory, 'README', new Set()), 'README')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
