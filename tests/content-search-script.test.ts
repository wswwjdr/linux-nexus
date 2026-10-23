import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildContentSearchScript } from '../src/main/content-search.ts'

const hasGnuSearchTools = process.platform === 'linux'
  && spawnSync('bash', ['-c', 'find -- . -maxdepth 0 -printf %s >/dev/null && base64 -w0 </dev/null >/dev/null && grep --version >/dev/null']).status === 0

test('content search script streams NUL-safe paths and reports binary and oversized files', { skip: !hasGnuSearchTools }, () => {
  const root = mkdtempSync(join(tmpdir(), 'linux-nexus-content-search-'))
  try {
    const textPath = join(root, 'line\nbreak [x].txt')
    writeFileSync(textPath, 'before\nNeedle hit\nafter\n')
    writeFileSync(join(root, 'binary.bin'), Buffer.concat([
      Buffer.from('needle'),
      Buffer.from([0]),
      Buffer.from('binary'),
    ]))
    writeFileSync(join(root, 'binary-two.bin'), Buffer.concat([
      Buffer.from('needle'),
      Buffer.from([0]),
      Buffer.from('x'),
    ]))
    writeFileSync(join(root, 'oversized.txt'), Buffer.alloc(1024 * 1024 + 1, 97))

    const result = spawnSync('bash', [
      '-c',
      buildContentSearchScript(),
      'content-search-test',
      root,
      'needle',
      '1',
      String(1024 * 1024),
    ])
    assert.equal(result.status, 0, result.stderr.toString('utf8'))

    const fields = result.stdout.toString('utf8').split('\0')
    const doneAt = fields.lastIndexOf('D')
    assert.notEqual(doneAt, -1)
    const summary = fields.slice(doneAt, doneAt + 8)
    assert.deepEqual(summary, ['D', '3', '45', '1', '1', '1', '2', '0'])

    const resultAt = fields.indexOf('R')
    assert.notEqual(resultAt, -1)
    assert.equal(Buffer.from(fields[resultAt + 2], 'base64').toString('utf8'), textPath)
    const lines: string[] = []
    for (let index = 0; index < fields.length - 1; index++) {
      if (fields[index] === 'L') lines.push(Buffer.from(fields[index + 1], 'base64').toString('utf8'))
    }
    assert.deepEqual(lines, ['1-before', '2:Needle hit', '3-after'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
