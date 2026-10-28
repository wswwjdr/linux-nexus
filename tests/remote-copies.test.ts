import assert from 'node:assert/strict'
import test from 'node:test'
import { posix } from 'node:path'
import type { RemoteCopyConflict, RemoteCopyDecision, RemoteCopyRequest } from '../src/shared/types.ts'
import type { SFTPWrapper } from 'ssh2'
import { executeRemoteCopy } from '../src/main/remote-copies.ts'

type EntryType = 'directory' | 'file' | 'symlink' | 'other'

interface MockEntry {
  type: EntryType
  content?: string
}

function makeSftp(initial: Record<string, MockEntry>) {
  const tree = new Map(Object.entries(initial))
  const modeFor = (type: EntryType) => ({
    directory: 0o040000,
    file: 0o100000,
    symlink: 0o120000,
    other: 0o060000,
  })[type]
  const fake = {
    lstat(path: string, callback: (error: Error | undefined, attributes?: { mode: number; size: number; mtime: number }) => void) {
      const entry = tree.get(path)
      if (!entry) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      callback(undefined, { mode: modeFor(entry.type), size: Buffer.byteLength(entry.content ?? ''), mtime: 1 })
    },
    readdir(path: string, callback: (error: Error | undefined, entries?: { filename: string; attrs: { mode: number; size: number; mtime: number } }[]) => void) {
      const directory = tree.get(path)
      if (!directory) return callback(Object.assign(new Error('No such file'), { code: 2 }))
      if (directory.type !== 'directory') return callback(new Error('Not a directory'))
      callback(undefined, [...tree.entries()]
        .filter(([entryPath]) => entryPath !== path && posix.dirname(entryPath) === path)
        .map(([entryPath, entry]) => ({
          filename: posix.basename(entryPath),
          attrs: { mode: modeFor(entry.type), size: Buffer.byteLength(entry.content ?? ''), mtime: 1 },
        })))
    },
    mkdir(path: string, callback: (error?: Error) => void) {
      if (tree.has(path)) return callback(new Error('Failure'))
      tree.set(path, { type: 'directory' })
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
    open(path: string, flags: 'r' | 'w', callback: (error: Error | undefined, handle?: Buffer) => void) {
      if (flags === 'r' && tree.get(path)?.type !== 'file') return callback(new Error('No such file'))
      if (flags === 'w') tree.set(path, { type: 'file', content: '' })
      callback(undefined, Buffer.from(path))
    },
    read(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | undefined, bytesRead?: number) => void) {
      const content = Buffer.from(tree.get(handle.toString())?.content ?? '')
      callback(undefined, content.copy(buffer, offset, position, position + length))
    },
    write(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error) => void) {
      const path = handle.toString()
      const current = Buffer.from(tree.get(path)?.content ?? '')
      const result = Buffer.alloc(Math.max(current.length, position + length))
      current.copy(result)
      buffer.copy(result, position, offset, offset + length)
      tree.set(path, { type: 'file', content: result.toString() })
      callback()
    },
    close(_handle: Buffer, callback: (error?: Error) => void) {
      callback()
    },
  }
  return { sftp: fake as unknown as SFTPWrapper, tree }
}

function request(sourcePaths: string[], targetDirectory = '/home/target'): RemoteCopyRequest {
  return { requestId: 'copy-test', sessionId: 'copy-session', sourcePaths, targetDirectory }
}

function runCopy(sftp: SFTPWrapper, copyRequest: RemoteCopyRequest, decisions: RemoteCopyDecision[] = []) {
  const conflicts: RemoteCopyConflict[] = []
  return executeRemoteCopy(sftp, copyRequest, {
    askConflict: async (conflict) => {
      conflicts.push(conflict)
      return decisions.shift() ?? 'cancel'
    },
    onEvent: () => {},
  }).then((result) => ({ result, conflicts }))
}

function baseEntries(): Record<string, MockEntry> {
  return {
    '/home': { type: 'directory' },
    '/home/target': { type: 'directory' },
  }
}

test('copy file conflicts support overwrite, skip, and automatic numbered renaming', async () => {
  const { sftp, tree } = makeSftp({
    ...baseEntries(),
    '/home/replace.txt': { type: 'file', content: 'new' },
    '/home/skip.txt': { type: 'file', content: 'source' },
    '/home/rename.tar.gz': { type: 'file', content: 'copy' },
    '/home/target/replace.txt': { type: 'file', content: 'old' },
    '/home/target/skip.txt': { type: 'file', content: 'keep' },
    '/home/target/rename.tar.gz': { type: 'file', content: 'old' },
    '/home/target/rename.tar (2).gz': { type: 'file', content: 'old numbered' },
  })

  const { result, conflicts } = await runCopy(sftp, request([
    '/home/replace.txt', '/home/skip.txt', '/home/rename.tar.gz',
  ]), ['replace', 'skip', 'rename'])

  assert.equal(conflicts.length, 3)
  assert.equal(result.copiedCount, 2)
  assert.equal(result.skippedCount, 1)
  assert.equal(tree.get('/home/target/replace.txt')?.content, 'new')
  assert.equal(tree.get('/home/target/skip.txt')?.content, 'keep')
  assert.equal(tree.get('/home/target/rename.tar (3).gz')?.content, 'copy')
})

test('copy applies rename-all to later conflicts throughout a merged directory', async () => {
  const { sftp, tree } = makeSftp({
    ...baseEntries(),
    '/home/source': { type: 'directory' },
    '/home/source/a.txt': { type: 'file', content: 'source a' },
    '/home/source/b.txt': { type: 'file', content: 'source b' },
    '/home/target/source': { type: 'directory' },
    '/home/target/source/a.txt': { type: 'file', content: 'target a' },
    '/home/target/source/b.txt': { type: 'file', content: 'target b' },
  })

  const { result, conflicts } = await runCopy(sftp, request(['/home/source']), ['rename-all'])

  assert.equal(conflicts.length, 1)
  assert.equal(result.failedCount, 0)
  assert.equal(tree.get('/home/target/source/a (2).txt')?.content, 'source a')
  assert.equal(tree.get('/home/target/source/b (2).txt')?.content, 'source b')
})

test('copy applies replace-all, skip-all, and rename-all to every later file conflict', async () => {
  for (const decision of ['replace-all', 'skip-all', 'rename-all'] as const) {
    const { sftp, tree } = makeSftp({
      ...baseEntries(),
      '/home/a.txt': { type: 'file', content: 'new a' },
      '/home/b.txt': { type: 'file', content: 'new b' },
      '/home/target/a.txt': { type: 'file', content: 'old a' },
      '/home/target/b.txt': { type: 'file', content: 'old b' },
    })

    const { result, conflicts } = await runCopy(sftp, request(['/home/a.txt', '/home/b.txt']), [decision])
    assert.equal(conflicts.length, 1)

    if (decision === 'replace-all') {
      assert.equal(tree.get('/home/target/a.txt')?.content, 'new a')
      assert.equal(tree.get('/home/target/b.txt')?.content, 'new b')
    } else if (decision === 'skip-all') {
      assert.equal(result.skippedCount, 2)
      assert.equal(tree.get('/home/target/a.txt')?.content, 'old a')
      assert.equal(tree.get('/home/target/b.txt')?.content, 'old b')
    } else {
      assert.equal(tree.get('/home/target/a (2).txt')?.content, 'new a')
      assert.equal(tree.get('/home/target/b (2).txt')?.content, 'new b')
    }
  }
})

test('copy resolves file/directory mismatches by renaming the source and preserving the target', async () => {
  const { sftp, tree } = makeSftp({
    ...baseEntries(),
    '/home/item': { type: 'file', content: 'source' },
    '/home/target/item': { type: 'directory' },
    '/home/target/item/keep.txt': { type: 'file', content: 'keep' },
  })

  const { result, conflicts } = await runCopy(sftp, request(['/home/item']), ['rename'])

  assert.equal(conflicts[0].conflictType, 'type-mismatch')
  assert.equal(result.failedCount, 0)
  assert.equal(tree.get('/home/target/item/keep.txt')?.content, 'keep')
  assert.equal(tree.get('/home/target/item (2)')?.content, 'source')

  const { sftp: unsafeSftp, tree: unsafeTree } = makeSftp({
    ...baseEntries(),
    '/home/item': { type: 'file', content: 'source' },
    '/home/target/item': { type: 'directory' },
    '/home/target/item/keep.txt': { type: 'file', content: 'keep' },
  })
  const unsafeReplace = await runCopy(unsafeSftp, request(['/home/item']), ['replace'])
  assert.equal(unsafeReplace.result.failedCount, 1)
  assert.equal(unsafeTree.get('/home/item')?.content, 'source')
  assert.equal(unsafeTree.get('/home/target/item/keep.txt')?.content, 'keep')
})

test('copying into the source directory uses the shared numbered name format', async () => {
  const { sftp, tree } = makeSftp({
    '/home': { type: 'directory' },
    '/home/source.tar.gz': { type: 'file', content: 'source' },
  })

  const { result, conflicts } = await runCopy(sftp, request(['/home/source.tar.gz'], '/home'))

  assert.equal(conflicts.length, 0)
  assert.equal(result.copiedCount, 1)
  assert.equal(tree.get('/home/source.tar (2).gz')?.content, 'source')
})
