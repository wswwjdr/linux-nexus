import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test, { type TestContext } from 'node:test'
import type { OperationExecutionStrategy } from '../src/shared/types'
import { commitRecord } from '../src/main/staged-write.ts'
import { buildUploadCommand } from '../src/main/transfers/upload-command.ts'

const git = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH ?? (git ? resolve(dirname(git), '../bin/bash.exe') : 'bash')
const available = spawnSync(bash, ['--version']).status === 0
const shellRequired = { skip: !available && 'GNU Bash required' }
const posixRequired = { skip: (!available || process.platform === 'win32') && 'POSIX filesystem required for mode and ACL assertions' }
const aclAvailable = available && process.platform !== 'win32'
  && spawnSync(bash, ['-c', 'command -v setfacl && command -v getfacl']).status === 0
const payload = Buffer.from('uploaded content\n')
const input = Buffer.concat([payload, commitRecord(createHash('sha256').update(payload).digest('hex'))])
const modifiedAt = 1_700_000_000

function fixture(t: TestContext, name = 'remote file.txt') {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-upload-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const path = join(directory, name)
  const remote = path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  // Git Bash cannot apply POSIX directory modes on NTFS; real mode/ACL checks run on POSIX only.
  const shellPrefix = process.platform === 'win32'
    ? 'mkdir() { if [[ $1 == -m ]]; then shift 2; fi; command mkdir "$@"; }\n'
    : ''
  const shell = (script: string, args = [remote], data?: Buffer) => spawnSync(bash, ['-c', shellPrefix + script, '--', ...args], { input: data, timeout: 10_000 })
  const run = (strategy: OperationExecutionStrategy = 'force', prefix = 'umask 022\n', data = input) =>
    shell(prefix + buildUploadCommand(strategy), [remote, String(modifiedAt), String(payload.length)], data)
  const inspect = (script: string) => {
    const result = shell(script)
    assert.equal(result.status, 0, result.stderr?.toString())
    return result.stdout.toString().trim()
  }
  const clean = () => assert.deepEqual(readdirSync(directory), [name])
  return { directory, path, shell, run, inspect, clean }
}

test('Chinese filenames use exactly .filename.uploading until publication', shellRequired, t => {
  const f = fixture(t, '音乐专辑.mp4')
  const result = f.run('force', `umask 022
head() {
  [[ -d "$directory/.音乐专辑.mp4.uploading" ]] || return 42
  [[ ! -e "$destination" ]] || return 43
  command head "$@"
}
`)
  assert.equal(result.status, 0, result.stderr.toString())
  assert.deepEqual(readFileSync(f.path), payload)
  f.clean()
})

for (const kind of ['directory', 'file'] as const) {
  test(`an existing staging ${kind} is neither reused nor cleaned`, shellRequired, t => {
    const f = fixture(t)
    writeFileSync(f.path, 'original')
    const staging = join(f.directory, '.remote file.txt.uploading')
    if (kind === 'directory') mkdirSync(staging)
    const existing = kind === 'directory' ? join(staging, 'content') : staging
    writeFileSync(existing, 'another upload')
    const result = f.run()
    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(existing, 'utf8'), 'another upload')
    assert.equal(readFileSync(f.path, 'utf8'), 'original')
    assert.deepEqual(readdirSync(f.directory).sort(), ['.remote file.txt.uploading', 'remote file.txt'])
  })
}

for (const strategy of ['force', 'skip', 'update'] as const) {
  test(`real upload creates a complete file with source mtime using ${strategy}`, shellRequired, t => {
    const f = fixture(t)
    const result = f.run(strategy)
    assert.equal(result.status, 0, result.stderr.toString())
    assert.deepEqual(readFileSync(f.path), payload)
    assert.equal(statSync(f.path).mtimeMs, modifiedAt * 1000)
    f.clean()
  })
}

for (const [mask, expected] of [['022', '644'], ['027', '640'], ['077', '600']]) {
  test(`new upload respects umask ${mask}`, posixRequired, t => {
    const f = fixture(t)
    const result = f.run('force', `umask ${mask}\n`)
    assert.equal(result.status, 0, result.stderr.toString())
    assert.equal(f.inspect('stat -c %a -- "$1"'), expected)
    f.clean()
  })
}

for (const mode of ['600', '640', '644', '755']) {
  test(`overwriting preserves mode ${mode} despite a different umask`, posixRequired, t => {
    const f = fixture(t)
    writeFileSync(f.path, 'original')
    assert.equal(f.shell(`chmod ${mode} -- "$1"`).status, 0)
    const result = f.run('force', 'umask 077\n')
    assert.equal(result.status, 0, result.stderr.toString())
    assert.equal(f.inspect('stat -c %a -- "$1"'), mode)
    assert.deepEqual(readFileSync(f.path), payload)
    f.clean()
  })
}

test('staged bytes stay inside a private directory until publication', posixRequired, t => {
  const f = fixture(t)
  const result = f.run('force', `umask 022
head() { [[ $(stat -c %a -- "$staging") == 700 ]] || return 42; [[ ! -e "$destination" ]] || return 43; command head "$@"; }
`)
  assert.equal(result.status, 0, result.stderr.toString())
  assert.deepEqual(readFileSync(f.path), payload)
  f.clean()
})

test('new uploads inherit default ACLs just like ordinary file creation', { skip: !aclAvailable && 'POSIX filesystem and ACL tools required' }, t => {
  const f = fixture(t)
  assert.equal(f.shell('setfacl -m d:u::rwx,d:u:12345:r--,d:g::---,d:m::r-x,d:o::--- -- "$(dirname -- "$1")"; umask 077; : > "$1.reference"').status, 0)
  const result = f.run('force', 'umask 077\n')
  assert.equal(result.status, 0, result.stderr.toString())
  assert.equal(f.inspect('getfacl -cn -- "$1"'), f.inspect('getfacl -cn -- "$1.reference"'))
})

test('overwriting preserves target access ACLs', { skip: !aclAvailable && 'POSIX filesystem and ACL tools required' }, t => {
  const f = fixture(t)
  writeFileSync(f.path, 'original')
  assert.equal(f.shell('chmod 640 -- "$1"; setfacl -m u:12345:r-- -- "$1"').status, 0)
  const original = f.inspect('getfacl -cn -- "$1"')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr.toString())
  assert.equal(f.inspect('getfacl -cn -- "$1"'), original)
  assert.deepEqual(readFileSync(f.path), payload)
  f.clean()
})

for (const strategy of ['skip', 'update'] as const) {
  test(`${strategy} leaves an existing newer file intact and cleans staging`, shellRequired, t => {
    const f = fixture(t)
    writeFileSync(f.path, 'original')
    const before = statSync(f.path).mtimeMs
    const result = f.run(strategy)
    assert.equal(result.status, 0, result.stderr.toString())
    assert.equal(readFileSync(f.path, 'utf8'), 'original')
    assert.equal(statSync(f.path).mtimeMs, before)
    f.clean()
  })
}

test('update replaces an older target', shellRequired, t => {
  const f = fixture(t)
  writeFileSync(f.path, 'original')
  assert.equal(f.shell('touch -d @1600000000 -- "$1"').status, 0)
  const result = f.run('update')
  assert.equal(result.status, 0, result.stderr.toString())
  assert.deepEqual(readFileSync(f.path), payload)
  f.clean()
})

test('failed metadata copy leaves the target intact and removes staging', shellRequired, t => {
  const f = fixture(t)
  writeFileSync(f.path, 'original')
  const result = f.run('force', 'cp() { return 42; };\n')
  assert.equal(result.status, 42, result.stderr.toString())
  assert.equal(readFileSync(f.path, 'utf8'), 'original')
  f.clean()
})

for (const data of [payload.subarray(0, 3), payload, Buffer.concat([payload, commitRecord('0'.repeat(64))])]) {
  test(`invalid upload (${data.length} bytes) cannot publish or leave staging`, shellRequired, t => {
    const f = fixture(t)
    writeFileSync(f.path, 'original')
    assert.notEqual(f.run('force', '', data).status, 0)
    assert.equal(readFileSync(f.path, 'utf8'), 'original')
    f.clean()
  })
}
