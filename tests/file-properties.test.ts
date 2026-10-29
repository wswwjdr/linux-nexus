import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { getRemoteEntryProperties, getRemoteDirectoryDiskUsage } from '../src/main/file-properties.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'

const fields = ['81a4', '1234', '644', '-rw-r--r--', '1000', 'alice', '1001', 'staff', '1700000000', '1700000001', '1700000002', '0', '']
const record = (values = fields) => values.join('\0') + '\0'

function attachSession(output: string, failure = '', hang = false) {
  const commands: string[] = []
  const signals: string[] = []
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    commands.push(command)
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void; signal: (signal: string) => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      if (hang) return
      channel.emit('data', Buffer.from(output))
      if (failure) channel.stderr.emit('data', Buffer.from(failure))
      channel.emit('exit', failure ? 1 : 0)
      channel.emit('close', failure ? 1 : 0)
    }
    channel.signal = (signal) => { signals.push(signal); channel.emit('close', 143) }
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  sessions.set('properties-session', { sessionId: 'properties-session', profileId: 'profile', kind: 'files', client })
  return { commands, signals, cleanup: () => sessions.delete('properties-session') }
}

test('reads fresh metadata with safe path arguments and explicit stat field meanings', async () => {
  const mock = attachSession(record())
  const path = "/home/中文 'file\n\t$(touch nope)"
  try {
    const value = await getRemoteEntryProperties('properties-session', path)
    assert.deepEqual(value, {
      name: path.slice(6), path, type: 'file', size: 1234, permissions: '644', symbolicPermissions: '-rw-r--r--',
      uid: 1000, owner: 'alice', gid: 1001, group: 'staff', accessedAt: '2023-11-14T22:13:20.000Z',
      modifiedAt: '2023-11-14T22:13:21.000Z', changedAt: '2023-11-14T22:13:22.000Z', createdAt: null, linkTarget: null,
    })
    assert.equal(mock.commands.length, 1)
    assert.ok(mock.commands[0].includes(shellQuote(path)))
    assert.ok(mock.commands[0].includes('stat --printf='))
    assert.ok(!mock.commands[0].includes('stat -L'))
  } finally { mock.cleanup() }
})

test('distinguishes directories, special files and dangling symlinks without following their targets', async () => {
  for (const [mode, symbolic, type, target] of [
    ['41ed', 'drwxr-xr-x', 'directory', ''],
    ['a1ff', 'lrwxrwxrwx', 'symlink', '../missing\n\t中文'],
    ['11a4', 'prw-r--r--', 'other', ''],
  ]) {
    const values = [...fields]
    values[0] = mode; values[3] = symbolic; values[11] = '1700000003'; values[12] = target
    const mock = attachSession(record(values))
    try {
      const result = await getRemoteEntryProperties('properties-session', '/')
      assert.equal(result.name, '/')
      assert.equal(result.type, type)
      assert.equal(result.linkTarget, target || null)
      assert.equal(result.createdAt, '2023-11-14T22:13:23.000Z')
      assert.ok(mock.commands[0].includes('readlink --zero -- "$1"'))
    } finally { mock.cleanup() }
  }
})

test('rejects malformed server metadata and invalid paths instead of displaying guessed values', async () => {
  const outputs = ['truncated', record().slice(0, -1)]
  for (const [index, invalid] of [[0, 'oops'], [1, '-1'], [1, '9007199254740992'], [2, '888'], [3, 'bad'], [4, 'NaN'], [8, '1e50'], [11, 'invalid'], [12, 'unexpected']] as const) {
    const values = [...fields]; values[index] = invalid; outputs.push(record(values))
  }
  for (const output of outputs) {
    const mock = attachSession(output)
    try { await assert.rejects(getRemoteEntryProperties('properties-session', '/file'), /属性格式无效/) }
    finally { mock.cleanup() }
  }
  const mock = attachSession(record())
  try {
    for (const path of ['', 'bad\0path']) {
      await assert.rejects(getRemoteEntryProperties('properties-session', path), /路径无效/)
      await assert.rejects(getRemoteDirectoryDiskUsage('properties-session', path), /路径无效/)
    }
    assert.equal(mock.commands.length, 0)
    await assert.rejects(getRemoteEntryProperties('disconnected', '/file'), /未连接/)
  } finally { mock.cleanup() }
})

test('calculates disk allocation using GNU du with a NUL-terminated path and no link traversal', async () => {
  const path = "/home/space 'dir\n\t中文"
  const mock = attachSession(`8192\t${path}\0`)
  try {
    assert.equal(await getRemoteDirectoryDiskUsage('properties-session', path), 8192)
    assert.ok(mock.commands[0].includes('du -s -B1 --null -- "$1"'))
    assert.ok(mock.commands[0].includes('! -L "$1" && -d "$1"'))
    assert.ok(mock.commands[0].includes(shellQuote(path)))
  } finally { mock.cleanup() }
})

test('propagates missing-file and permission errors; partial du totals are never accepted', async () => {
  for (const failure of ['No such file or directory', 'Permission denied']) {
    const mock = attachSession('4096\t/dir\0', failure)
    try {
      await assert.rejects(getRemoteEntryProperties('properties-session', '/file'), { message: failure })
      await assert.rejects(getRemoteDirectoryDiskUsage('properties-session', '/dir'), { message: failure })
    } finally { mock.cleanup() }
  }
  for (const output of ['4096\t/wrong\0', '12x\t/dir\0', '-1\t/dir\0', '9007199254740992\t/dir\0', '4096\t/dir\n']) {
    const mock = attachSession(output)
    try { await assert.rejects(getRemoteDirectoryDiskUsage('properties-session', '/dir'), /占用空间.*无效/) }
    finally { mock.cleanup() }
  }
})

test('terminates a directory scan at the configured 30 second timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mock = attachSession('', '', true)
  try {
    const pending = getRemoteDirectoryDiskUsage('properties-session', '/dir')
    t.mock.timers.tick(29_999)
    assert.deepEqual(mock.signals, [])
    t.mock.timers.tick(1)
    await assert.rejects(pending, /超时/)
    assert.deepEqual(mock.signals, ['TERM'])
  } finally { mock.cleanup() }
})

const gitPath = process.platform === 'win32'
  ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0]
  : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH
  ?? (process.platform === 'win32' && gitPath ? resolve(dirname(gitPath), '../bin/bash.exe') : 'bash')
const hasGnuTools = spawnSync(bash, ['-c', 'stat --version >/dev/null && du --version >/dev/null']).status === 0

test('reads real GNU stat and du output through the SSH command protocol', { skip: !hasGnuTools }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-properties-'))
  const remotePath = directory.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  const name = process.platform === 'win32' ? "中文 ' $(touch nope).txt" : "中文 '\n\t$(touch nope).txt"
  const content = '属性读取测试'
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      execFile(bash, ['-c', command], { encoding: 'buffer' }, (error, stdout, stderr) => {
        channel.emit('data', stdout)
        channel.stderr.emit('data', stderr)
        channel.emit('exit', error ? 1 : 0)
        channel.emit('close', error ? 1 : 0)
      })
    }
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  sessions.set('real-properties', { sessionId: 'real-properties', profileId: 'profile', kind: 'files', client })
  try {
    await writeFile(join(directory, name), content)
    const file = await getRemoteEntryProperties('real-properties', remotePath + '/' + name)
    assert.equal(file.name, name)
    assert.equal(file.type, 'file')
    assert.equal(file.size, Buffer.byteLength(content))
    const folder = await getRemoteEntryProperties('real-properties', remotePath)
    assert.equal(folder.type, 'directory')
    const bytes = await getRemoteDirectoryDiskUsage('real-properties', remotePath)
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0)
  } finally {
    sessions.delete('real-properties')
    assert.ok(directory.startsWith(join(tmpdir(), 'nexus-properties-')))
    await rm(directory, { recursive: true, force: true })
  }
})
