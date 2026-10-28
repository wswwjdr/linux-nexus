import assert from 'node:assert/strict'
import test from 'node:test'
import { posix } from 'node:path'
import type { RemoteMoveConflict, RemoteMoveDecision, RemoteMoveRequest } from '../src/shared/types.ts'
import type { SFTPWrapper } from 'ssh2'
import { executeRemoteMove } from '../src/main/remote-moves.ts'

type EntryType = 'directory' | 'file' | 'symlink' | 'other'

interface MockEntry {
  type: EntryType
  content?: string
}

interface MockSftpOptions {
  mountRoots?: string[]
  failRename?: (sourcePath: string, targetPath: string) => boolean
}

function sftpError(message: string, code: string | number = 4): Error {
  return Object.assign(new Error(message), { code })
}

function makeSftp(initial: Record<string, MockEntry>, options: MockSftpOptions = {}): SFTPWrapper {
  const tree = new Map(Object.entries(initial))
  const modeFor = (type: EntryType) => ({
    directory: 0o040000,
    file: 0o100000,
    symlink: 0o120000,
    other: 0o060000,
  })[type]
  const mountFor = (remotePath: string) => options.mountRoots
    ?.filter((root) => remotePath === root || remotePath.startsWith(root + '/'))
    .sort((left, right) => right.length - left.length)[0] ?? '/'
  const fake = {
    lstat(remotePath: string, callback: (error: Error | undefined, attributes?: { mode: number; size: number; mtime: number }) => void) {
      const entry = tree.get(remotePath)
      if (!entry) return callback(sftpError('No such file', 2))
      callback(undefined, { mode: modeFor(entry.type), size: entry.content?.length ?? 0, mtime: 1 })
    },
    readdir(remotePath: string, callback: (error: Error | undefined, entries?: { filename: string; attrs: { mode: number; size: number; mtime: number } }[]) => void) {
      const directory = tree.get(remotePath)
      if (!directory) return callback(sftpError('No such file', 2))
      if (directory.type !== 'directory') return callback(sftpError('Not a directory'))
      const entries = [...tree.entries()]
        .filter(([path]) => path !== remotePath && posix.dirname(path) === remotePath)
        .map(([path, entry]) => ({
          filename: posix.basename(path),
          attrs: { mode: modeFor(entry.type), size: entry.content?.length ?? 0, mtime: 1 },
        }))
      callback(undefined, entries)
    },
    rename(sourcePath: string, targetPath: string, callback: (error?: Error) => void) {
      if (options.failRename?.(sourcePath, targetPath)) return callback(sftpError('Permission denied'))
      if (mountFor(sourcePath) !== mountFor(targetPath)) return callback(sftpError('Cross-device link', 'EXDEV'))
      const source = tree.get(sourcePath)
      if (!source) return callback(sftpError('No such file', 2))
      if (tree.has(targetPath)) return callback(sftpError('Failure'))
      const moved = [...tree.entries()].filter(([path]) => path === sourcePath || path.startsWith(sourcePath + '/'))
      for (const [path] of moved) tree.delete(path)
      for (const [path, entry] of moved) tree.set(targetPath + path.slice(sourcePath.length), entry)
      callback()
    },
    unlink(remotePath: string, callback: (error?: Error) => void) {
      const entry = tree.get(remotePath)
      if (!entry) return callback(sftpError('No such file', 2))
      if (entry.type === 'directory') return callback(sftpError('Is a directory'))
      tree.delete(remotePath)
      callback()
    },
    rmdir(remotePath: string, callback: (error?: Error) => void) {
      if (!tree.has(remotePath)) return callback(sftpError('No such file', 2))
      if ([...tree.keys()].some((path) => path !== remotePath && posix.dirname(path) === remotePath)) {
        return callback(sftpError('Directory not empty'))
      }
      tree.delete(remotePath)
      callback()
    },
  }
  return fake as unknown as SFTPWrapper
}

function request(sourcePaths: string[], targetDirectory = '/home/target'): RemoteMoveRequest {
  return {
    requestId: 'move-test',
    sessionId: 'session-test',
    sourcePaths,
    targetDirectory,
  }
}

function assertMissing(sftp: SFTPWrapper, remotePath: string) {
  return assert.rejects(new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error) => error ? reject(error) : resolve(undefined))
  }))
}

function runMove(
  sftp: SFTPWrapper,
  moveRequest: RemoteMoveRequest,
  decisions: RemoteMoveDecision[] = [],
) {
  const conflicts: RemoteMoveConflict[] = []
  const events = []
  return executeRemoteMove(sftp, moveRequest, {
    askConflict: async (conflict) => {
      conflicts.push(conflict)
      return decisions.shift() ?? 'cancel'
    },
    onEvent: (event) => events.push(event),
  }).then((result) => ({ result, conflicts, events }))
}

test('moves files and folders with SFTP rename', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' },
    '/home/target': { type: 'directory' },
    '/home/report.txt': { type: 'file', content: 'report' },
    '/home/folder': { type: 'directory' },
    '/home/folder/nested.txt': { type: 'file', content: 'nested' },
  })

  const { result } = await runMove(sftp, request(['/home/report.txt', '/home/folder']))

  assert.equal(result.status, 'completed')
  assert.equal(result.movedCount, 2)
  assert.deepEqual(result.results.map((item) => item.status), ['moved', 'moved'])
  await assertMissing(sftp, '/home/report.txt')
  await new Promise<void>((resolve, reject) => sftp.lstat('/home/target/folder/nested.txt', (error) => error ? reject(error) : resolve()))
})

test('recursively merges same-name folders and preserves target-only entries', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' },
    '/home/target': { type: 'directory' },
    '/home/source': { type: 'directory' },
    '/home/source/nested': { type: 'directory' },
    '/home/source/nested/source.txt': { type: 'file', content: 'source' },
    '/home/source/source-only.txt': { type: 'file', content: 'only' },
    '/home/target/source': { type: 'directory' },
    '/home/target/source/nested': { type: 'directory' },
    '/home/target/source/nested/target-only.txt': { type: 'file', content: 'keep' },
    '/home/target/source/target-only.txt': { type: 'file', content: 'keep' },
  })

  const { result, conflicts } = await runMove(sftp, request(['/home/source']))

  assert.equal(result.movedCount, 4)
  assert.equal(result.failedCount, 0)
  assert.deepEqual(conflicts, [])
  for (const path of [
    '/home/target/source/nested/source.txt',
    '/home/target/source/nested/target-only.txt',
    '/home/target/source/target-only.txt',
  ]) {
    await new Promise<void>((resolve, reject) => sftp.lstat(path, (error) => error ? reject(error) : resolve()))
  }
  await assertMissing(sftp, '/home/source')
})

test('file conflicts support replace-all and skip-all policies', async () => {
  const replacementSftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/a': { type: 'file', content: 'new a' }, '/home/b': { type: 'file', content: 'new b' },
    '/home/target/a': { type: 'file', content: 'old a' }, '/home/target/b': { type: 'file', content: 'old b' },
  })
  const replaced = await runMove(replacementSftp, request(['/home/a', '/home/b']), ['replace-all'])
  assert.equal(replaced.conflicts.length, 1)
  assert.equal(replaced.result.movedCount, 2)
  assert.equal(replaced.result.failedCount, 0)

  const skipSftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/a': { type: 'file', content: 'new a' }, '/home/b': { type: 'file', content: 'new b' },
    '/home/target/a': { type: 'file', content: 'old a' }, '/home/target/b': { type: 'file', content: 'old b' },
  })
  const skipped = await runMove(skipSftp, request(['/home/a', '/home/b']), ['skip-all'])
  assert.equal(skipped.conflicts.length, 1)
  assert.equal(skipped.result.skippedCount, 2)
  assert.equal(skipped.result.movedCount, 0)
})

test('file conflicts support numbered renaming and apply rename-all to later files', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/a.tar.gz': { type: 'file', content: 'new a' }, '/home/b.txt': { type: 'file', content: 'new b' },
    '/home/target/a.tar.gz': { type: 'file', content: 'old a' },
    '/home/target/a.tar (2).gz': { type: 'file', content: 'existing numbered' },
    '/home/target/b.txt': { type: 'file', content: 'old b' },
  })

  const { result, conflicts } = await runMove(sftp, request(['/home/a.tar.gz', '/home/b.txt']), ['rename-all'])

  assert.equal(conflicts.length, 1)
  assert.equal(result.movedCount, 2)
  assert.equal(result.failedCount, 0)
  await assertMissing(sftp, '/home/a.tar.gz')
  await assertMissing(sftp, '/home/b.txt')
  await new Promise<void>((resolve, reject) => sftp.lstat('/home/target/a.tar (3).gz', (error) => error ? reject(error) : resolve()))
  await new Promise<void>((resolve, reject) => sftp.lstat('/home/target/b (2).txt', (error) => error ? reject(error) : resolve()))
})

test('individual file conflicts can be replaced or skipped independently', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/replace.txt': { type: 'file', content: 'new' }, '/home/skip.txt': { type: 'file', content: 'keep source' },
    '/home/target/replace.txt': { type: 'file', content: 'old' }, '/home/target/skip.txt': { type: 'file', content: 'keep target' },
  })

  const { result, conflicts } = await runMove(
    sftp,
    request(['/home/replace.txt', '/home/skip.txt']),
    ['replace', 'skip'],
  )

  assert.equal(conflicts.length, 2)
  assert.equal(result.movedCount, 1)
  assert.equal(result.skippedCount, 1)
  assert.deepEqual(result.results.map((item) => item.status), ['moved', 'skipped'])
})

test('type mismatch rejects target replacement and still permits skipping', async () => {
  const replacementSftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/item': { type: 'file', content: 'source' },
    '/home/target/item': { type: 'directory' }, '/home/target/item/old.txt': { type: 'file', content: 'old' },
  })
  const replaced = await runMove(replacementSftp, request(['/home/item']), ['replace'])
  assert.equal(replaced.conflicts[0].conflictType, 'type-mismatch')
  assert.equal(replaced.result.movedCount, 0)
  assert.equal(replaced.result.failedCount, 1)
  await new Promise<void>((resolve, reject) => replacementSftp.lstat('/home/item', (error) => error ? reject(error) : resolve()))
  await new Promise<void>((resolve, reject) => replacementSftp.lstat('/home/target/item/old.txt', (error) => error ? reject(error) : resolve()))

  const skipSftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/item': { type: 'file', content: 'source' },
    '/home/target/item': { type: 'directory' }, '/home/target/item/old.txt': { type: 'file', content: 'old' },
  })
  const skipped = await runMove(skipSftp, request(['/home/item']), ['skip'])
  assert.equal(skipped.result.skippedCount, 1)
  await new Promise<void>((resolve, reject) => skipSftp.lstat('/home/target/item/old.txt', (error) => error ? reject(error) : resolve()))

})

test('type mismatches rename the source item without deleting the target', async () => {
  const fileToDirectory = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/item': { type: 'file', content: 'source file' },
    '/home/target/item': { type: 'directory' }, '/home/target/item/keep.txt': { type: 'file', content: 'keep' },
  })
  const movedFile = await runMove(fileToDirectory, request(['/home/item']), ['rename'])
  assert.equal(movedFile.conflicts[0].conflictType, 'type-mismatch')
  assert.equal(movedFile.result.movedCount, 1)
  await new Promise<void>((resolve, reject) => fileToDirectory.lstat('/home/target/item/keep.txt', (error) => error ? reject(error) : resolve()))
  await new Promise<void>((resolve, reject) => fileToDirectory.lstat('/home/target/item (2)', (error) => error ? reject(error) : resolve()))

  const directoryToFile = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/item': { type: 'directory' }, '/home/item/child.txt': { type: 'file', content: 'source child' },
    '/home/target/item': { type: 'file', content: 'target file' },
  })
  const movedDirectory = await runMove(directoryToFile, request(['/home/item']), ['rename'])
  assert.equal(movedDirectory.conflicts[0].conflictType, 'type-mismatch')
  assert.equal(movedDirectory.result.movedCount, 1)
  await new Promise<void>((resolve, reject) => directoryToFile.lstat('/home/target/item', (error) => error ? reject(error) : resolve()))
  await new Promise<void>((resolve, reject) => directoryToFile.lstat('/home/target/item (2)/child.txt', (error) => error ? reject(error) : resolve()))
})

test('cancellation preserves completed moves and leaves later sources untouched', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/first': { type: 'file' }, '/home/conflict': { type: 'file' }, '/home/later': { type: 'file' },
    '/home/target/conflict': { type: 'file' },
  })

  const { result } = await runMove(sftp, request(['/home/first', '/home/conflict', '/home/later']), ['cancel'])

  assert.equal(result.status, 'cancelled')
  assert.equal(result.movedCount, 1)
  assert.equal(result.cancelledCount, 1)
  assert.equal(result.results.length, 2)
  await new Promise<void>((resolve, reject) => sftp.lstat('/home/target/first', (error) => error ? reject(error) : resolve()))
  await new Promise<void>((resolve, reject) => sftp.lstat('/home/later', (error) => error ? reject(error) : resolve()))
})

test('continues after one failed item and reports cross-filesystem rename without copy fallback', async () => {
  const sftp = makeSftp({
    '/srv': { type: 'directory' }, '/srv/dest': { type: 'directory' },
    '/srv/fails': { type: 'file' }, '/srv/works': { type: 'file' },
  }, {
    failRename: (sourcePath) => sourcePath === '/srv/fails',
  })
  const { result } = await runMove(sftp, request(['/srv/fails', '/srv/works'], '/srv/dest'))

  assert.equal(result.status, 'completed')
  assert.equal(result.failedCount, 1)
  assert.equal(result.movedCount, 1)
  assert.match(result.results[0].message ?? '', /Permission denied/)
  await assertMissing(sftp, '/srv/works')
  await new Promise<void>((resolve, reject) => sftp.lstat('/srv/dest/works', (error) => error ? reject(error) : resolve()))

  const crossDeviceSftp = makeSftp({
    '/srv': { type: 'directory' }, '/srv/dest': { type: 'directory' }, '/srv/item': { type: 'file' },
  }, { mountRoots: ['/srv/dest'] })
  const crossDevice = await runMove(crossDeviceSftp, request(['/srv/item'], '/srv/dest'))
  assert.match(crossDevice.result.results[0].message ?? '', /跨远端文件系统/)
  await new Promise<void>((resolve, reject) => crossDeviceSftp.lstat('/srv/item', (error) => error ? reject(error) : resolve()))
})

test('rejects root, duplicate, unsupported, non-directory and self-descendant moves', async () => {
  const sftp = makeSftp({
    '/home': { type: 'directory' }, '/home/target': { type: 'directory' },
    '/home/file': { type: 'file' }, '/home/link': { type: 'symlink' },
    '/home/folder': { type: 'directory' }, '/home/folder/child': { type: 'directory' },
    '/home/not-a-folder': { type: 'file' },
  })
  const rejects = (moveRequest: RemoteMoveRequest, message: RegExp) => assert.rejects(
    () => runMove(sftp, moveRequest),
    message,
  )

  await rejects(request(['/']), /根目录/)
  await rejects(request(['/home/file', '/home/file']), /重复路径/)
  await rejects(request(['/home/link']), /不支持移动/)
  await rejects(request(['/home/file'], '/home/not-a-folder'), /不是文件夹/)
  await rejects(request(['/home/folder'], '/home/folder/child'), /不能将文件夹移动到自身或其子文件夹/)
  await rejects(request(['/home/folder'], '/home/folder'), /不能将文件夹移动到自身或其子文件夹/)
})
