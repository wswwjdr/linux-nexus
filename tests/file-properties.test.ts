import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile, spawnSync } from 'node:child_process'
import { link, mkdir, mkdtemp, truncate, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { getRemoteDirectoryStats, getRemoteEntryProperties } from '../src/main/file-properties.ts'
import { cancelRemoteDirectoryUsageTree, getRemoteDirectoryUsageTree } from '../src/main/directory-usage-tree.ts'
import { revokeFileIdentity } from '../src/main/file-identity.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'
import { DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT } from '../src/shared/app-settings.ts'

const fields = ['81a4', '1234', '644', '-rw-r--r--', '1000', 'alice', '1001', 'staff', '1700000000', '1700000001', '1700000002', '0', '']
const record = (values = fields) => values.join('\0') + '\0'

function attachSession(output: string | Buffer[], failure = '', hang = false) {
  const commands: string[] = []
  const signals: string[] = []
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    commands.push(command)
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void; close: () => void; signal: (signal: string) => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      if (hang) return
      for (const chunk of typeof output === 'string' ? [Buffer.from(output)] : output) channel.emit('data', chunk)
      if (failure) channel.stderr.emit('data', Buffer.from(failure))
      channel.emit('exit', failure ? 1 : 0)
      channel.emit('close', failure ? 1 : 0)
    }
    channel.signal = (signal) => { signals.push(signal); channel.emit('close', 143) }
    channel.close = () => channel.emit('close', 143)
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
      await assert.rejects(getRemoteDirectoryStats('properties-session', path), /路径无效/)
    }
    assert.equal(mock.commands.length, 0)
    await assert.rejects(getRemoteEntryProperties('disconnected', '/file'), /未连接/)
  } finally { mock.cleanup() }
})

test('requests allocation and entry counts in one SSH command with a safely quoted path', async () => {
  const path = "/home/space 'dir\n\t中文"
  const mock = attachSession('8192\t12\t345\n')
  try {
    assert.deepEqual(await getRemoteDirectoryStats('properties-session', path), { allocatedBytes: 8192, directoryCount: 12, fileCount: 345 })
    assert.equal(mock.commands.length, 1)
    assert.ok(mock.commands[0].includes('du -P -s -B1 -- "$1"'))
    assert.ok(mock.commands[0].includes('find -P -- "$1" -mindepth 1'))
    assert.ok(mock.commands[0].includes('! -L "$1" && -d "$1"'))
    assert.ok(mock.commands[0].includes(shellQuote(path)))
  } finally { mock.cleanup() }
})

test('propagates scan errors even when the server also sends a valid-looking result', async () => {
  for (const failure of ['No such file or directory', 'Permission denied']) {
    const mock = attachSession('4096\t1\t2\n', failure)
    try {
      await assert.rejects(getRemoteEntryProperties('properties-session', '/file'), { message: failure })
      await assert.rejects(getRemoteDirectoryStats('properties-session', '/dir'), { message: failure })
    } finally { mock.cleanup() }
  }
})

test('rejects truncated, extra, negative and unsafe statistics fields', async () => {
  for (const output of ['4096\t0\n', '4096\t0\t2', '4096\t0\t2\n\n', '4096\t0\t2\t3\n', '12x\t0\t2\n',
    '4096\t-1\t2\n', '4096\t0\t1.2\n', '9007199254740992\t0\t2\n', '4096\t0\t9007199254740992\n']) {
    const mock = attachSession(output)
    try { await assert.rejects(getRemoteDirectoryStats('properties-session', '/dir'), /目录统计.*无效/) }
    finally { mock.cleanup() }
  }
})

test('terminates a directory scan at the configured 30 second timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mock = attachSession('', '', true)
  try {
    const pending = getRemoteDirectoryStats('properties-session', '/dir')
    t.mock.timers.tick(29_999)
    assert.deepEqual(mock.signals, [])
    t.mock.timers.tick(1)
    await assert.rejects(pending, /超时/)
    assert.deepEqual(mock.signals, ['TERM'])
  } finally { mock.cleanup() }
})

const usageRecord = (depth: number, name: string, kind: string, blocks = 8, inode = '1', links = 1, device = '10') =>
  record([String(depth), name, kind, String(blocks), device, inode, String(links)])
const usageRoot = usageRecord(0, 'dir', 'd')
const readUsage = (limit = DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT) => getRemoteDirectoryUsageTree('properties-session', '/dir', 'scan', limit)

test('detailed usage parses chunked paths and only bills shared allocation once per device and inode', async () => {
  const bytes = Buffer.from(usageRoot + usageRecord(1, '一', 'd', 4) + usageRecord(2, '\ufeff中文\n\t.txt', 'f', 12, '9007199254740993', 2)
    + usageRecord(1, '二', 'd', 4) + usageRecord(2, 'alias', 'f', 12, '9007199254740993', 2)
    + usageRecord(2, 'other device', 'f', 2, '9007199254740993', 2, '11') + usageRecord(1, 'link', 'l', 0))
  const mock = attachSession(Array.from(bytes, byte => Buffer.from([byte])))
  try {
    const nodes = await readUsage()
    assert.deepEqual(nodes.map(({ parentIndex, allocatedBytes, sharedAllocation }) => [parentIndex, allocatedBytes, sharedAllocation]), [
      [null, 15360, false], [0, 8192, false], [1, 6144, false], [0, 3072, false], [3, 6144, true], [3, 1024, false], [0, 0, false],
    ])
    assert.equal(nodes[2].name, '\ufeff中文\n\t.txt')
    assert.equal(nodes[6].type, 'symlink')
    assert.equal(mock.commands.length, 1)
    assert.ok(mock.commands[0].includes('exec find -P -- "$1"'))
  } finally { mock.cleanup() }
})

test('detailed usage rejects incomplete or malformed trees and preserves remote scan failures', async () => {
  for (const output of ['', usageRoot.slice(0, -1), usageRecord(0, 'dir', 'l'), usageRoot + usageRecord(2, 'skip', 'f'),
    usageRoot + usageRecord(1, 'file', 'f') + usageRecord(2, 'child', 'f'), usageRoot + usageRecord(1, '../escape', 'f'),
    usageRoot + usageRecord(1, 'dup', 'f').repeat(2), usageRoot + usageRecord(1, 'large', 'f', Number.MAX_SAFE_INTEGER)]) {
    const mock = attachSession(output)
    try { await assert.rejects(readUsage(), /树无效或不完整/) } finally { mock.cleanup() }
  }
  const denied = attachSession(usageRoot, 'Permission denied')
  try { await assert.rejects(readUsage(), /Permission denied/) } finally { denied.cleanup() }
})

test('detailed usage applies the configured descendant limit', async () => {
  const records = Array.from({ length: 100_001 }, (_, index) => usageRecord(1, String(index), 'f', 0))
  const allowed = attachSession(usageRoot + records.slice(0, -1).join(''))
  try { assert.equal((await readUsage()).length, 100_001) } finally { allowed.cleanup() }
  const overflow = attachSession(usageRoot + records.join(''))
  try {
    await assert.rejects(readUsage(), /100,000 个条目/)
    assert.deepEqual(overflow.signals, ['TERM'])
  } finally { overflow.cleanup() }
  const raised = attachSession(usageRoot + records.join(''))
  try { assert.equal((await readUsage(200_000)).length, 100_002) } finally { raised.cleanup() }
})

test('detailed usage can run past 120 seconds and cancels by request or on identity revocation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const mock = attachSession('', '', true)
  try {
    let pending = readUsage()
    await assert.rejects(readUsage(), /正在运行/)
    assert.equal(cancelRemoteDirectoryUsageTree('different'), false)
    assert.equal(cancelRemoteDirectoryUsageTree('scan'), true)
    await assert.rejects(pending, /取消/)
    assert.equal(cancelRemoteDirectoryUsageTree('scan'), false)

    pending = readUsage()
    t.mock.timers.tick(600_000)
    assert.deepEqual(mock.signals, ['TERM'])

    const revoke = revokeFileIdentity(sessions.get('properties-session')!)
    await assert.rejects(pending, /取消/)
    await revoke
    assert.deepEqual(mock.signals, ['TERM', 'TERM'])
  } finally { mock.cleanup() }
})

const gitPath = process.platform === 'win32'
  ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0]
  : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH
  ?? (process.platform === 'win32' && gitPath ? resolve(dirname(gitPath), '../bin/bash.exe') : 'bash')
const hasGnuTools = spawnSync(bash, ['-c', 'stat --version >/dev/null && du --version >/dev/null && find --version >/dev/null && command -v awk >/dev/null']).status === 0

test('reads GNU metadata and recursively aggregates real files through the SSH command protocol', { skip: !hasGnuTools }, async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'nexus-properties-'))
  const name = process.platform === 'win32' ? "中文 ' $(touch nope).txt" : "中文 '\n\t$(touch nope).txt"
  const directory = join(fixture, name + '.folder')
  const remotePath = process.platform === 'win32'
    ? directory.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
    : directory
  const content = '属性读取测试'
  const env = { ...process.env, MSYS: 'winsymlinks:sys' }
  let prefix = ''
  let stdoutReceived = ''
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      execFile(bash, ['-c', prefix + command], { encoding: 'buffer', env }, (error, stdout, stderr) => {
        stdoutReceived = stdout.toString('utf8')
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
    await mkdir(directory)
    const empty = await getRemoteDirectoryStats('real-properties', remotePath)
    assert.ok(empty.allocatedBytes >= 0)
    assert.equal(empty.directoryCount, 0)
    assert.equal(empty.fileCount, 0)
    const emptyTree = await getRemoteDirectoryUsageTree('real-properties', remotePath, 'real-scan', DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT)
    assert.deepEqual(emptyTree.map(node => [node.type, node.allocatedBytes]), [['directory', empty.allocatedBytes]])
    await writeFile(join(directory, name), content)
    await mkdir(join(directory, '.hidden', 'nested'), { recursive: true })
    await writeFile(join(directory, '.hidden', 'nested', '.file'), content)
    const links = spawnSync(bash, ['-c', 'cd -- "$1" && ln -s .hidden link && ln -s missing dangling && [[ -L link && -L dangling ]]', '--', remotePath], { env, encoding: 'utf8' })
    assert.equal(links.status, 0, links.stderr)
    if (process.platform !== 'win32') {
      const fifo = spawnSync(bash, ['-c', 'mkfifo -- "$1/fifo"', '--', remotePath], { encoding: 'utf8' })
      assert.equal(fifo.status, 0, fifo.stderr)
    }
    const file = await getRemoteEntryProperties('real-properties', remotePath + '/' + name)
    assert.equal(file.name, name)
    assert.equal(file.type, 'file')
    assert.equal(file.size, Buffer.byteLength(content))
    const folder = await getRemoteEntryProperties('real-properties', remotePath)
    assert.equal(folder.type, 'directory')
    const stats = await getRemoteDirectoryStats('real-properties', remotePath)
    const du = spawnSync(bash, ['-c', 'du -s -B1 -- "$1"', '--', remotePath], { env, encoding: 'utf8' })
    assert.equal(du.status, 0, du.stderr)
    assert.deepEqual(stats, { allocatedBytes: Number(du.stdout.split('\t')[0]), directoryCount: 2, fileCount: 2 })
    await assert.rejects(getRemoteDirectoryStats('real-properties', remotePath + '/link'), /只能统计文件夹/)

    await link(join(directory, name), join(directory, '.hidden', 'alias'))
    await writeFile(join(directory, 'sparse'), '')
    await truncate(join(directory, 'sparse'), 64 * 1024 * 1024)
    const tree = await getRemoteDirectoryUsageTree('real-properties', remotePath, 'real-scan', DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT)
    const detailedSummary = await getRemoteDirectoryStats('real-properties', remotePath)
    assert.equal(tree[0].allocatedBytes, detailedSummary.allocatedBytes)
    const hardLinks = tree.filter(node => node.name === name || node.name === 'alias')
    assert.equal(hardLinks.length, 2)
    assert.equal(hardLinks.filter(node => node.sharedAllocation).length, 1)
    assert.equal(hardLinks[0].allocatedBytes, hardLinks[1].allocatedBytes)
    assert.deepEqual(tree.filter(node => node.type === 'symlink').map(node => node.name).sort(), ['dangling', 'link'])
    assert.equal(tree.filter(node => node.name === 'nested').length, 1)
    const sparse = spawnSync(bash, ['-c', 'du -s -B1 -- "$1/sparse"', '--', remotePath], { env, encoding: 'utf8' })
    assert.equal(sparse.status, 0, sparse.stderr)
    assert.equal(tree.find(node => node.name === 'sparse')?.allocatedBytes, Number(sparse.stdout.split('\t')[0]))
    await assert.rejects(getRemoteDirectoryUsageTree('real-properties', remotePath + '/link', 'real-scan', DEFAULT_DIRECTORY_USAGE_ENTRY_LIMIT), /只能统计文件夹/)

    prefix = "find() { printf 'f\\n'; printf 'Permission denied\\n' >&2; return 1; }; export -f find; "
    await assert.rejects(getRemoteDirectoryStats('real-properties', remotePath), /Permission denied/)
    assert.equal(stdoutReceived, '')
  } finally {
    sessions.delete('real-properties')
    assert.ok(fixture.startsWith(join(tmpdir(), 'nexus-properties-')))
    await rm(fixture, { recursive: true, force: true })
  }
})
