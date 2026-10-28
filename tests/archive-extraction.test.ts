import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { posix } from 'node:path'
import type { Client, SFTPWrapper } from 'ssh2'
import type { RemoteArchiveConflict, RemoteArchiveDecision, RemoteArchiveRequest } from '../src/shared/types.ts'
import { cancelRemoteArchiveExtraction, startRemoteArchiveExtraction } from '../src/main/archives.ts'
import { executeRemoteCommand } from '../src/main/sftp-utils.ts'

type MockEntry = { type: 'directory' | 'file' | 'symlink' | 'other'; content?: string }

class MockChannel extends EventEmitter {
  stderr = new EventEmitter()
  close() { this.emit('close') }
}

class DelayedCloseChannel extends MockChannel {
  closeCalls = 0
  close() {
    this.closeCalls += 1
    setTimeout(() => this.emit('close'), 15)
  }
}

function makeRemote(
  initial: Record<string, MockEntry>,
  payload: Record<string, MockEntry>,
  commandError?: string,
  options: { connectionClosed?: boolean; failRename?: (source: string, target: string) => boolean; preparationDelayMs?: number } = {},
) {
  const tree = new Map(Object.entries(initial))
  const mode = (type: MockEntry['type']) => ({ directory: 0o040000, file: 0o100000, symlink: 0o120000, other: 0o060000 })[type]
  const add = (path: string, entry: MockEntry) => tree.set(path, entry)
  const sftp = {
    lstat(path: string, callback: (error: Error | undefined, attrs?: { mode: number; size: number; mtime: number }) => void) {
      const entry = tree.get(path)
      if (!entry) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      callback(undefined, { mode: mode(entry.type), size: entry.content?.length ?? 0, mtime: 1 })
    },
    readdir(path: string, callback: (error: Error | undefined, entries?: { filename: string; attrs: { mode: number; size: number; mtime: number } }[]) => void) {
      const directory = tree.get(path)
      if (!directory) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      if (directory.type !== 'directory') return callback(new Error('Not a directory'))
      callback(undefined, [...tree.entries()]
        .filter(([entryPath]) => entryPath !== path && posix.dirname(entryPath) === path)
        .map(([entryPath, entry]) => ({
          filename: posix.basename(entryPath),
          attrs: { mode: mode(entry.type), size: entry.content?.length ?? 0, mtime: 1 },
        })))
    },
    mkdir(path: string, callback: (error?: Error) => void) {
      if (tree.has(path)) return callback(new Error('Failure'))
      tree.set(path, { type: 'directory' })
      callback()
    },
    rename(source: string, destination: string, callback: (error?: Error) => void) {
      if (options.failRename?.(source, destination)) return callback(new Error('Permission denied'))
      if (tree.has(destination)) return callback(new Error('Failure'))
      if (!tree.has(source)) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      const entries = [...tree.entries()].filter(([path]) => path === source || path.startsWith(source + '/'))
      for (const [path] of entries) tree.delete(path)
      for (const [path, entry] of entries) tree.set(destination + path.slice(source.length), entry)
      callback()
    },
    unlink(path: string, callback: (error?: Error) => void) {
      if (!tree.delete(path)) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      callback()
    },
    rmdir(path: string, callback: (error?: Error) => void) {
      if ([...tree.keys()].some((entryPath) => entryPath !== path && posix.dirname(entryPath) === path)) return callback(new Error('Directory not empty'))
      if (!tree.delete(path)) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      callback()
    },
    writeFile(path: string, data: Buffer | string, callback: (error?: Error) => void) {
      tree.set(path, { type: 'file', content: Buffer.isBuffer(data) ? data.toString() : data })
      callback()
    },
  } as unknown as SFTPWrapper

  const client = new EventEmitter() as EventEmitter & { exec: (command: string, callback: (error: Error | undefined, stream?: MockChannel) => void) => void }
  client.exec = (command, callback) => {
    const stage = command.match(/stage='([^']+)'/)?.[1]
    assert.ok(stage)
    callback(undefined, channel)
    if (commandError) {
      queueMicrotask(() => {
        channel.stderr.emit('data', Buffer.from(commandError))
        channel.emit('exit', 1)
        channel.emit('close')
      })
      return
    }
    add(stage, { type: 'directory' })
    add(stage + '/payload', { type: 'directory' })
    for (const [relative, entry] of Object.entries(payload)) {
      let parent = posix.dirname(relative)
      const parents: string[] = []
      while (parent !== '.') {
        parents.unshift(parent)
        parent = posix.dirname(parent)
      }
      for (const folder of parents) add(stage + '/payload/' + folder, { type: 'directory' })
      add(stage + '/payload/' + relative, entry)
    }
    const finishPreparation = () => {
      if (options.connectionClosed) {
        client.emit('close')
        return
      }
      channel.emit('exit', 0)
      channel.emit('close')
    }
    if (options.preparationDelayMs) setTimeout(finishPreparation, options.preparationDelayMs)
    else queueMicrotask(finishPreparation)
  }
  const channel = new MockChannel()
  return {
    client: client as unknown as Client,
    sftp,
    tree,
    has: (path: string) => tree.has(path),
  }
}

function request(requestId: string, wrapInDirectory = false): RemoteArchiveRequest {
  return {
    requestId,
    sessionId: requestId,
    archivePath: '/home/release.zip',
    targetDirectory: '/home/target',
    wrapInDirectory,
  }
}

function runExtraction(
  remote: ReturnType<typeof makeRemote>,
  extractionRequest: RemoteArchiveRequest,
  decisions: RemoteArchiveDecision[] = [],
) {
  const conflicts: RemoteArchiveConflict[] = []
  return startRemoteArchiveExtraction(remote.client, remote.sftp, extractionRequest, {
    onEvent: () => {},
    askConflict: async (conflict) => {
      conflicts.push(conflict)
      return decisions.shift() ?? 'cancel'
    },
  }).then((result) => ({ result, conflicts }))
}

function baseInitial(): Record<string, MockEntry> {
  return {
    '/': { type: 'directory' },
    '/home': { type: 'directory' },
    '/home/target': { type: 'directory' },
    '/home/release.zip': { type: 'file' },
  }
}

test('merges same-name directories and renames an individual conflicting file', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/package': { type: 'directory' },
    '/home/target/package/readme.txt': { type: 'file', content: 'existing' },
  }, {
    'package/readme.txt': { type: 'file', content: 'archive' },
    'package/new.txt': { type: 'file', content: 'new' },
  })

  const { result, conflicts } = await runExtraction(remote, request('archive-merge'), ['rename'])

  assert.equal(result.status, 'completed')
  assert.equal(result.failedCount, 0)
  assert.equal(result.extractedCount, 3)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].conflictType, 'file')
  assert.ok(remote.has('/home/target/package/readme.txt'))
  assert.ok(remote.has('/home/target/package/readme (2).txt'))
  assert.ok(remote.has('/home/target/package/new.txt'))
  assert.equal([...remote.tree.keys()].some((path) => path.includes('.linux-nexus-extract-')), false)
})

test('applies automatic renaming to later file conflicts and preserves file extensions', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/a.tar.gz': { type: 'file' },
    '/home/target/b': { type: 'file' },
  }, {
    'a.tar.gz': { type: 'file' },
    b: { type: 'file' },
  })

  const { result, conflicts } = await runExtraction(remote, request('archive-rename-all'), ['rename-all'])

  assert.equal(conflicts.length, 1)
  assert.equal(result.extractedCount, 2)
  assert.ok(remote.has('/home/target/a.tar (2).gz'))
  assert.ok(remote.has('/home/target/b (2)'))
})

test('file conflicts support individual replace and skip choices', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/replace.txt': { type: 'file', content: 'old' },
    '/home/target/skip.txt': { type: 'file', content: 'keep' },
  }, {
    'replace.txt': { type: 'file', content: 'new' },
    'skip.txt': { type: 'file', content: 'new' },
  })

  const { result, conflicts } = await runExtraction(remote, request('archive-individual'), ['replace', 'skip'])

  assert.equal(conflicts.length, 2)
  assert.equal(result.extractedCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.equal(remote.tree.get('/home/target/replace.txt')?.content, 'new')
  assert.equal(remote.tree.get('/home/target/skip.txt')?.content, 'keep')
})

test('target permission failures are reported while later entries still merge', async () => {
  const remote = makeRemote(baseInitial(), {
    denied: { type: 'file' },
    succeeds: { type: 'file' },
  }, undefined, {
    failRename: (source) => source.endsWith('/payload/denied'),
  })

  const { result } = await runExtraction(remote, request('archive-permission'))

  assert.equal(result.status, 'completed')
  assert.equal(result.failedCount, 1)
  assert.equal(result.extractedCount, 1)
  assert.match(result.results[0].message ?? '', /Permission denied/)
  assert.ok(remote.has('/home/target/succeeds'))
})

test('replace-all and skip-all policies apply to following file conflicts', async () => {
  for (const decision of ['replace-all', 'skip-all'] as const) {
    const remote = makeRemote({
      ...baseInitial(),
      '/home/target/a.txt': { type: 'file', content: 'old a' },
      '/home/target/b.txt': { type: 'file', content: 'old b' },
    }, {
      'a.txt': { type: 'file', content: 'new a' },
      'b.txt': { type: 'file', content: 'new b' },
    })
    const { result, conflicts } = await runExtraction(remote, request(`archive-${decision}`), [decision])
    assert.equal(conflicts.length, 1)
    if (decision === 'replace-all') {
      assert.equal(result.extractedCount, 2)
      assert.equal(remote.tree.get('/home/target/a.txt')?.content, 'new a')
      assert.equal(remote.tree.get('/home/target/b.txt')?.content, 'new b')
    } else {
      assert.equal(result.skippedCount, 2)
      assert.equal(remote.tree.get('/home/target/a.txt')?.content, 'old a')
      assert.equal(remote.tree.get('/home/target/b.txt')?.content, 'old b')
    }
  }
})

test('type mismatches remain individually confirmed and support skip or rename', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/item': { type: 'directory' },
    '/home/target/item/keep.txt': { type: 'file' },
  }, { item: { type: 'file' } })

  const { result, conflicts } = await runExtraction(remote, request('archive-type'), ['rename'])

  assert.equal(conflicts[0].conflictType, 'type-mismatch')
  assert.equal(result.failedCount, 0)
  assert.ok(remote.has('/home/target/item/keep.txt'))
  assert.ok(remote.has('/home/target/item (2)'))

  const skippedRemote = makeRemote({
    ...baseInitial(),
    '/home/target/item': { type: 'directory' },
    '/home/target/item/keep.txt': { type: 'file' },
  }, { item: { type: 'file' } })
  const skipped = await runExtraction(skippedRemote, request('archive-type-skip'), ['skip'])
  assert.equal(skipped.conflicts[0].conflictType, 'type-mismatch')
  assert.equal(skipped.result.skippedCount, 1)
  assert.ok(skippedRemote.has('/home/target/item/keep.txt'))
  assert.equal(skippedRemote.has('/home/target/item (2)'), false)
})

test('the wrapped output directory can be renamed when a file blocks its name', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/release': { type: 'file' },
  }, { 'hello.txt': { type: 'file' } })

  const { result, conflicts } = await runExtraction(remote, request('archive-wrap', true), ['rename'])

  assert.equal(conflicts[0].memberPath, 'release/')
  assert.equal(result.outputDirectory, '/home/target/release (2)')
  assert.ok(remote.has('/home/target/release (2)/hello.txt'))
  assert.ok(remote.has('/home/target/release'))
})

test('cancellation keeps completed target changes and cleans the remaining stage', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/a.txt': { type: 'file' },
    '/home/target/b.txt': { type: 'file' },
  }, {
    'a.txt': { type: 'file' },
    'b.txt': { type: 'file' },
  })

  const { result } = await runExtraction(remote, request('archive-cancel'), ['cancel'])

  assert.equal(result.status, 'cancelled')
  assert.equal(result.cancelledCount, 2)
  assert.ok(remote.has('/home/target/a.txt'))
  assert.ok(remote.has('/home/target/b.txt'))
  assert.equal([...remote.tree.keys()].some((path) => path.includes('.linux-nexus-extract-')), false)
})

test('cancelling while a conflict decision is pending releases the task and cleans staging', async () => {
  const remote = makeRemote({
    ...baseInitial(),
    '/home/target/a.txt': { type: 'file' },
  }, { 'a.txt': { type: 'file' } })
  const extractionRequest = request('archive-cancel-pending')
  const task = startRemoteArchiveExtraction(remote.client, remote.sftp, extractionRequest, {
    onEvent: () => {},
    askConflict: (_conflict, signal) => new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve('cancel'), { once: true })
    }),
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(cancelRemoteArchiveExtraction(extractionRequest.requestId), true)
  const result = await task
  assert.equal(result.status, 'cancelled')
  assert.equal([...remote.tree.keys()].some((path) => path.includes('.linux-nexus-extract-')), false)
})

test('cancelling remote preparation waits for the command and removes its marker and staging directory', async () => {
  const remote = makeRemote(baseInitial(), { file: { type: 'file' } }, undefined, { preparationDelayMs: 30 })
  const extractionRequest = request('archive-cancel-preparation')
  const task = runExtraction(remote, extractionRequest)

  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(cancelRemoteArchiveExtraction(extractionRequest.requestId), true)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const cancellationPath = [...remote.tree.keys()].find((path) => path.endsWith('.cancel'))
  assert.ok(cancellationPath)
  assert.ok(remote.has(cancellationPath.replace(/\.cancel$/, '')))

  const { result } = await task
  assert.equal(result.status, 'cancelled')
  assert.equal(remote.has(cancellationPath), false)
  assert.equal(remote.has(cancellationPath.replace(/\.cancel$/, '')), false)
})

test('remote preparation failures remain observable and remove the temporary directory', async () => {
  const remote = makeRemote(baseInitial(), {}, 'python3: command not found')

  await assert.rejects(runExtraction(remote, request('archive-no-python')), /python3: command not found/)
  assert.equal([...remote.tree.keys()].some((path) => path.includes('.linux-nexus-extract-')), false)
})

test('an SSH interruption during extraction is returned as an observable failure and cleans staging', async () => {
  const remote = makeRemote(baseInitial(), { file: { type: 'file' } }, undefined, { connectionClosed: true })

  await assert.rejects(runExtraction(remote, request('archive-connection-loss')), /SSH 连接已关闭/)
  assert.equal([...remote.tree.keys()].some((path) => path.includes('.linux-nexus-extract-')), false)
})

test('aborting a remote command waits for its channel to close before returning', async () => {
  const client = new EventEmitter() as EventEmitter & {
    exec: (_command: string, callback: (error: Error | undefined, stream?: DelayedCloseChannel) => void) => void
  }
  client.exec = (_command, callback) => callback(undefined, new DelayedCloseChannel())
  const controller = new AbortController()
  let settled = false
  const task = executeRemoteCommand(client as unknown as Client, 'remote-command', controller.signal)
    .finally(() => { settled = true })

  controller.abort()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(settled, false)
  await assert.rejects(task, /远程命令已取消/)
  assert.equal(settled, true)
})

test('archive cancellation waits for the remote cancellation marker before settling', async () => {
  const client = new EventEmitter() as EventEmitter & {
    exec: (_command: string, callback: (error: Error | undefined, stream?: DelayedCloseChannel) => void) => void
  }
  const channel = new DelayedCloseChannel()
  client.exec = (_command, callback) => callback(undefined, channel)
  const controller = new AbortController()
  let settled = false
  const task = executeRemoteCommand(client as unknown as Client, 'remote-command', controller.signal, () => new Promise((resolve) => {
    setTimeout(() => {
      channel.emit('exit', 1)
      channel.emit('close')
      setTimeout(resolve, 15)
    }, 0)
  })).finally(() => { settled = true })

  controller.abort()
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(settled, false)
  assert.equal(channel.closeCalls, 0)
  await assert.rejects(task, /远程命令已取消/)
  assert.equal(settled, true)
})
