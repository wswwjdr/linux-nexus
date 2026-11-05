import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { buildTextSaveCommand } from '../src/main/previews/strategies/text-preview.ts'
import { missingTextSavePackages } from '../src/main/previews/text-save-dependencies.ts'
import { RemoteCommandError } from '../src/main/ssh-commands.ts'
import { commitRecord } from '../src/main/staged-write.ts'
const git = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH ?? (git ? resolve(dirname(git), '../bin/bash.exe') : 'bash')
const available = spawnSync(bash, ['-c', 'command -v getfacl && command -v getfattr'], { encoding: 'utf8' }).status === 0
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

test('reports all missing packages before validating or writing the destination', { skip: spawnSync(bash, ['--version']).status !== 0 }, () => {
  const simulateMissingTools = 'command() { [[ "$2" != getfacl && "$2" != getfattr ]]; };\n'
  const result = spawnSync(bash, ['-c', simulateMissingTools + buildTextSaveCommand(), '--', '/nonexistent/destination', '', '', '0', '0'], { encoding: 'utf8' })
  assert.deepEqual(missingTextSavePackages(new RemoteCommandError(result.status, result.stderr)), ['acl', 'attr'])
})

test('real metadata-preserving save refuses conflicts, truncated input and hardlinks, then commits explicitly', { skip: !available && 'GNU Bash, acl and attr tools required' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-text-save-'))
  const path = join(directory, 'config.txt')
  const remote = path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  const bytes = Buffer.from('new content')
  const input = Buffer.concat([bytes, commitRecord(hash(bytes))])
  try {
    writeFileSync(path, 'old')
    execFileSync(bash, ['-c', 'chmod 640 -- "$1"; setfacl -m u:12345:r-- -- "$1"; setfattr -n user.nexus -v preserved -- "$1"', '--', remote])
    const metadata = () => execFileSync(bash, ['-c', 'stat -c "%u:%g:%a" -- "$1"; getfacl -cn -- "$1"; getfattr --only-values -n user.nexus -- "$1"', '--', remote]).toString()
    const originalMetadata = metadata()
    const run = (force: string, data = input) => spawnSync(bash, ['-c', buildTextSaveCommand(), '--', remote, 'a'.repeat(64), 'stale', force, String(bytes.length)], { input: data })
    assert.equal(run('0').status, 73)
    assert.equal(readFileSync(path, 'utf8'), 'old')
    assert.notEqual(run('1', bytes.subarray(0, 3)).status, 0)
    assert.equal(readFileSync(path, 'utf8'), 'old')
    assert.notEqual(run('1', bytes).status, 0) // Correct length but no producer commit record.
    assert.equal(readFileSync(path, 'utf8'), 'old')
    const result = run('1')
    assert.equal(result.status, 0, result.stderr.toString())
    assert.equal(readFileSync(path, 'utf8'), 'new content')
    assert.equal(metadata(), originalMetadata)
    execFileSync(bash, ['-c', 'ln -- "$1" "$1.link"', '--', remote])
    assert.notEqual(run('1').status, 0)
    assert.equal(readFileSync(path, 'utf8'), 'new content')
    assert.deepEqual(readdirSync(directory).sort(), ['config.txt', 'config.txt.link'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})


test('metadata inspection failure leaves source content intact and removes staged files', { skip: spawnSync(bash, ['--version']).status !== 0 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-text-failure-'))
  const path = join(directory, 'config.txt')
  const remote = path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  try {
    writeFileSync(path, 'original')
    const bytes = Buffer.from('new')
    const result = spawnSync(bash, ['-c', 'getfacl() { return 42; }; getfattr() { return 0; }; ' + buildTextSaveCommand(), '--', remote, 'a'.repeat(64), 'stale', '1', '3'], { input: Buffer.concat([bytes, commitRecord(hash(bytes))]) })
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(path, 'utf8'), 'original')
    assert.deepEqual(readdirSync(directory), ['config.txt'])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
