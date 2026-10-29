import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { execFile, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { cancelRemoteOperation, executeRemoteOperation } from '../src/main/remote-operations.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'
import type { OperationExecutionRequest } from '../src/shared/types.ts'

class MockChannel extends EventEmitter {
  stderr = new EventEmitter()
  signals: string[] = []
  onEnd?: (channel: MockChannel) => void

  end(): void {
    this.onEnd?.(this)
  }

  signal(signal: string): void {
    this.signals.push(signal)
    queueMicrotask(() => {
      this.emit('exit', 143)
      this.emit('close', 143)
    })
  }

  close(): void {
    queueMicrotask(() => {
      this.emit('exit', 143)
      this.emit('close', 143)
    })
  }

  complete(stdout = Buffer.alloc(0), exitCode = 0): void {
    if (stdout.length) this.emit('data', stdout)
    this.emit('exit', exitCode)
    this.emit('close', exitCode)
  }
}

function mockClient(respond: (command: string, index: number, channel: MockChannel) => void) {
  const commands: string[] = []
  const channels: MockChannel[] = []
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new MockChannel()
    const index = commands.push(command) - 1
    channels.push(channel)
    respond(command, index, channel)
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  return { client, commands, channels }
}

function copyRequest(strategy: OperationExecutionRequest['strategy'] = 'force'): OperationExecutionRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    operation: 'copy',
    sourcePaths: ['/home/space name', '/home/中文\n文件'],
    targetDirectory: '/home/target',
    strategy,
  }
}

function attachSession(client: Client): void {
  sessions.set('session-1', { sessionId: 'session-1', client, kind: 'files', profileId: 'profile-1' })
}

for (const operation of ['copy', 'move'] as const) {
  for (const strategy of ['force', 'skip'] as const) {
    test(`${operation} ${strategy} executes in one SSH command with quoted paths`, async () => {
      const remote = mockClient((_command, _index, channel) => {
        channel.onEnd = (current) => current.complete()
      })
      attachSession(remote.client)
      try {
        const source = "/home/space ' quote\n中文; $(touch nope)"
        const result = await executeRemoteOperation({ ...copyRequest(strategy), operation, sourcePaths: [source] })
        assert.equal(result.status, 'completed')
        assert.equal(remote.commands.length, 1)
        assert.ok(remote.commands[0].includes(shellQuote(source)))
        const utility = operation === 'copy' ? 'cp -R --preserve=mode,timestamps' : 'mv'
        assert.ok(remote.commands[0].includes(`${utility} -${strategy === 'force' ? 'f' : 'n'} -- "$@"`))
        assert.ok(!remote.commands[0].includes('find --'))
        assert.ok(!remote.commands[0].includes('mktemp'))
      } finally { sessions.delete('session-1') }
    })
  }
}

// Exercise the actual generated server command, including filesystem collisions.
const gitPath = process.platform === 'win32'
  ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0]
  : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH
  ?? (process.platform === 'win32' && gitPath ? resolve(dirname(gitPath), '../bin/bash.exe') : 'bash')
const bashAvailable = spawnSync(bash, ['--version']).status === 0

async function withFilesystem(action: (context: {
  directory: string
  run: (sources: string[], options?: { target?: string; operation?: 'copy' | 'move'; strategy?: 'force' | 'skip' }) => Promise<void>
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-paste-'))
  const remoteDirectory = directory.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive: string) => '/' + drive.toLowerCase())
  const remote = mockClient((command, _index, channel) => {
    channel.onEnd = (current) => {
      execFile(bash, ['-c', command], { encoding: 'buffer' }, (error, stdout, stderr) => {
        if (stderr.length) current.stderr.emit('data', stderr)
        current.complete(stdout, error ? (typeof error.code === 'number' ? error.code : 1) : 0)
      })
    }
  })
  attachSession(remote.client)
  try {
    await action({
      directory,
      run: async (sources, { target = '', operation = 'copy', strategy = 'force' } = {}) => {
        const result = await executeRemoteOperation({
          ...copyRequest(strategy), requestId: crypto.randomUUID(), operation,
          sourcePaths: sources.map((source) => remoteDirectory + '/' + source),
          targetDirectory: remoteDirectory + (target ? '/' + target : ''),
        })
        assert.equal(result.status, 'completed')
      },
    })
  } finally {
    sessions.delete('session-1')
    await rm(directory, { recursive: true, force: true })
  }
}

const filesystemTest = { skip: !bashAvailable && 'Bash is required for remote command filesystem tests' }
const specialName = process.platform === 'win32' ? "中文 ' $文件.txt" : "中文 ' $文件\n.txt"

for (const strategy of ['force', 'skip'] as const) {
  test(`same-directory ${strategy} copy numbers files and folders without modifying existing entries`, filesystemTest, async () => {
    await withFilesystem(async ({ directory, run }) => {
      for (const name of ['test.txt', 'README', '.env', '.config.json', specialName]) {
        await writeFile(join(directory, name), 'source:' + name)
      }
      await writeFile(join(directory, 'test(2).txt'), 'existing')
      await mkdir(join(directory, 'test(3).txt'))
      await mkdir(join(directory, 'folder.with.dots'))
      await writeFile(join(directory, 'folder.with.dots', 'nested.txt'), 'nested')
      await mkdir(join(directory, 'folder.with.dots(2)'))
      await writeFile(join(directory, 'folder.with.dots(2)', 'keep.txt'), 'keep')
      await run(['test.txt', 'README', '.env', '.config.json', specialName, 'folder.with.dots'], { strategy })
      await run(['test.txt'], { strategy })
      for (const name of ['test(4).txt', 'test(5).txt']) assert.equal(await readFile(join(directory, name), 'utf8'), 'source:test.txt')
      assert.equal(await readFile(join(directory, 'test.txt'), 'utf8'), 'source:test.txt')
      assert.equal(await readFile(join(directory, 'test(2).txt'), 'utf8'), 'existing')
      for (const [source, copy] of [
        ['README', 'README(2)'], ['.env', '.env(2)'], ['.config.json', '.config(2).json'],
        [specialName, specialName.slice(0, -4) + '(2).txt'],
      ]) assert.equal(await readFile(join(directory, copy), 'utf8'), 'source:' + source)
      assert.equal(await readFile(join(directory, 'folder.with.dots(3)', 'nested.txt'), 'utf8'), 'nested')
      assert.deepEqual(await readdir(join(directory, 'folder.with.dots(2)')), ['keep.txt'])
    })
  })
}

test('simultaneous same-directory copies reserve different names', filesystemTest, async () => {
  await withFilesystem(async ({ directory, run }) => {
    await writeFile(join(directory, 'test.txt'), 'content')
    await mkdir(join(directory, 'folder'))
    await writeFile(join(directory, 'folder', 'nested.txt'), 'nested')
    await Promise.all(Array.from({ length: 4 }, () => run(['test.txt', 'folder'])))
    for (let index = 2; index <= 5; index++) {
      assert.equal(await readFile(join(directory, `test(${index}).txt`), 'utf8'), 'content')
      assert.equal(await readFile(join(directory, `folder(${index})`, 'nested.txt'), 'utf8'), 'nested')
    }
  })
})

test('same-directory moves keep sources in place and mixed copies still obey cross-directory strategies', filesystemTest, async () => {
  await withFilesystem(async ({ directory, run }) => {
    await writeFile(join(directory, 'test.txt'), 'original')
    await mkdir(join(directory, 'folder'))
    await run(['test.txt', 'folder'], { operation: 'move' })
    assert.deepEqual((await readdir(directory)).sort(), ['folder', 'test.txt'])
    await mkdir(join(directory, 'other'))
    await writeFile(join(directory, 'other', 'test.txt'), 'other')
    await run(['test.txt', 'other/test.txt'], { strategy: 'skip' })
    assert.equal(await readFile(join(directory, 'test.txt'), 'utf8'), 'original')
    assert.equal(await readFile(join(directory, 'test(2).txt'), 'utf8'), 'original')
    await run(['other/test.txt'])
    assert.equal(await readFile(join(directory, 'test.txt'), 'utf8'), 'other')
    await run(['other/test.txt'], { target: 'folder', operation: 'move' })
    assert.equal(await readFile(join(directory, 'folder', 'test.txt'), 'utf8'), 'other')
    assert.equal(existsSync(join(directory, 'other', 'test.txt')), false)
  })
})

test('same-directory copy reports a missing source instead of creating an empty duplicate', filesystemTest, async () => {
  await withFilesystem(async ({ directory, run }) => {
    await assert.rejects(run(['missing.txt']), /来源可能已不存在/)
    await assert.rejects(run(['missing.txt'], { operation: 'move' }), /移动来源已不存在/)
    assert.deepEqual(await readdir(directory), [])
  })
})

test('directory aliases use same-directory naming and moves remain in place', filesystemTest, async () => {
  await withFilesystem(async ({ directory, run }) => {
    await writeFile(join(directory, 'test.txt'), 'content')
    await symlink(directory, join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    await run(['alias/test.txt'])
    await run(['test.txt'], { target: 'alias' })
    await run(['test.txt'], { target: 'alias', operation: 'move' })
    for (const name of ['test.txt', 'test(2).txt', 'test(3).txt']) {
      assert.equal(await readFile(join(directory, name), 'utf8'), 'content')
    }
  })
})

test('a dangling symlink occupies a duplicate name', {
  skip: !bashAvailable || process.platform === 'win32' ? 'Requires a POSIX filesystem with symlinks' : false,
}, async () => {
  await withFilesystem(async ({ directory, run }) => {
    await writeFile(join(directory, 'test.txt'), 'content')
    await symlink('missing', join(directory, 'test(2).txt'))
    await run(['test.txt'])
    assert.equal(await readFile(join(directory, 'test(3).txt'), 'utf8'), 'content')
    assert.equal(existsSync(join(directory, 'missing')), false)
  })
})

for (const [archive, options] of [
  ['release.tar.gz', ['--overwrite', '--skip-old-files', '--keep-newer-files']],
  ['release.zip', ['-o', '-n', '-u']],
] as const) {
  for (const [index, strategy] of (['force', 'skip', 'update'] as const).entries()) {
    test(`extracts ${archive} with ${strategy} directly without scanning`, async () => {
      const remote = mockClient((_command, _index, channel) => {
        channel.onEnd = (current) => current.complete()
      })
      attachSession(remote.client)
      try {
        const result = await executeRemoteOperation({
          ...copyRequest(), operation: 'extract', sourcePaths: [],
          archivePath: '/home/' + archive, wrapInDirectory: true, strategy,
        })
        assert.equal(result.status, 'completed')
        assert.equal(remote.commands.length, 1)
        assert.ok(remote.commands[0].includes('mkdir -p -- "$output"'))
        assert.ok(remote.commands[0].includes(options[index]))
        assert.ok(remote.commands[0].includes(shellQuote('/home/target/release')))
        assert.ok(!remote.commands[0].includes('find --'))
        assert.ok(!remote.commands[0].includes('mktemp'))
      } finally { sessions.delete('session-1') }
    })
  }
}

test('rejects invalid requests before opening an SSH channel', () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    for (const targetDirectory of ['/home/source', '/home/source/nested']) {
      assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/home/source'], targetDirectory }), /自身或其子文件夹/)
    }
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/'] }), /来源路径无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), sourcePaths: ['/a', '/a'] }), /来源路径无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), strategy: 'confirm' } as unknown as OperationExecutionRequest), /参数无效/)
    assert.throws(() => executeRemoteOperation({ ...copyRequest(), strategy: 'update' }), /仅支持覆盖或跳过/)
    assert.equal(remote.commands.length, 0)
  } finally { sessions.delete('session-1') }
})

const backslashArchive = "/home/临时 测试/QuickLook-3.7.3 'test'.zip"
const backslashWarning = `warning:  ${backslashArchive} appears to use backslashes as path separators\n`

for (const strategy of ['force', 'skip', 'update'] as const) {
  test(`ZIP ${strategy} treats a lone backslash warning as ordinary completion`, async () => {
    const remote = mockClient((_command, _index, channel) => {
      channel.onEnd = (current) => {
        current.stderr.emit('data', Buffer.from(backslashWarning))
        current.complete(Buffer.alloc(0), 1)
      }
    })
    attachSession(remote.client)
    try {
      const result = await executeRemoteOperation({
        ...copyRequest(strategy), operation: 'extract', sourcePaths: [],
        archivePath: backslashArchive, wrapInDirectory: false,
      })
      assert.deepEqual(result, {
        status: 'completed', requestId: 'request-1', operation: 'extract', command: remote.commands[0],
      })
      assert.equal(remote.commands.length, 1)
      assert.ok(remote.commands[0].includes('"$output" 1>&2'))
    } finally { sessions.delete('session-1') }
  })
}

for (const [label, operation, archivePath, exitCode, stderr] of [
  ['additional warning', 'extract', backslashArchive, 1, backslashWarning + 'skipping: encrypted.txt  incorrect password\n'],
  ['unsupported compression', 'extract', backslashArchive, 1, 'skipping: file.bin  unsupported compression method 99\n'],
  ['write failure', 'extract', backslashArchive, 50, backslashWarning + 'write error (disk full?)\n'],
  ['severe exit code', 'extract', backslashArchive, 2, backslashWarning],
  ['different archive', 'extract', '/home/other.zip', 1, backslashWarning],
  ['tar failure', 'extract', '/home/a.tar', 1, backslashWarning],
  ['copy failure', 'copy', undefined, 1, backslashWarning],
] as const) {
  test(`does not suppress ${label} as ZIP compatibility`, async () => {
    const remote = mockClient((_command, _index, channel) => {
      channel.onEnd = (current) => {
        current.stderr.emit('data', Buffer.from(stderr))
        current.complete(Buffer.alloc(0), exitCode)
      }
    })
    attachSession(remote.client)
    try {
      await assert.rejects(executeRemoteOperation({
        ...copyRequest(), operation,
        ...(operation === 'extract' ? { sourcePaths: [], archivePath, wrapInDirectory: false } : {}),
      }), { message: stderr })
    } finally { sessions.delete('session-1') }
  })
}

for (const [operation, error] of [
  ['move', 'mv: cannot move: Directory not empty'],
  ['extract', 'unzip: command not found'],
] as const) {
  test(`propagates server ${operation} errors without retries`, async () => {
    const remote = mockClient((_command, _index, channel) => {
      channel.onEnd = (current) => {
        current.stderr.emit('data', Buffer.from(error))
        current.complete(Buffer.alloc(0), 1)
      }
    })
    attachSession(remote.client)
    try {
      await assert.rejects(executeRemoteOperation({ ...copyRequest(), operation,
        ...(operation === 'extract' ? { sourcePaths: [], archivePath: '/home/a.zip', wrapInDirectory: false } : {}),
      }), { message: error })
      assert.equal(remote.commands.length, 1)
    } finally { sessions.delete('session-1') }
  })
}

test('rejects duplicate request IDs and cancels the active command through SSH', async () => {
  const remote = mockClient(() => {})
  attachSession(remote.client)
  try {
    const pending = executeRemoteOperation(copyRequest())
    assert.throws(() => executeRemoteOperation(copyRequest()), /编号重复/)
    assert.equal(remote.commands.length, 1)
    assert.equal(cancelRemoteOperation('request-1'), true)
    assert.equal((await pending).status, 'cancelled')
    assert.deepEqual(remote.channels[0].signals, ['TERM'])
    assert.equal(cancelRemoteOperation('request-1'), false)
  } finally { sessions.delete('session-1') }
})
