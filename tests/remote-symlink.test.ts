import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { filesSession, listRemoteDirectory, resolveRemoteNavigationTarget } from '../src/main/remote-fs.ts'
import { sessions } from '../src/main/runtime.ts'

const git = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH ?? (git ? resolve(dirname(git), '../bin/bash.exe') : 'bash')
const hasReadlink = spawnSync(bash, ['-c', 'readlink --canonicalize-existing --zero -- .']).status === 0

test('resolves directories, files and symbolic links for navigation using the remote filesystem', { skip: !hasReadlink && 'Bash and GNU readlink are required' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'linux-nexus-symlink-'))
  const sessionId = 'symlink-session'
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      const result = spawnSync(bash, ['-c', command], { cwd: directory, timeout: 10_000 })
      if (result.error) throw result.error
      channel.emit('data', result.stdout)
      channel.stderr.emit('data', result.stderr)
      channel.emit('exit', result.status)
      channel.emit('close', result.status)
    }
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  sessions.set(sessionId, { sessionId, profileId: 'profile', kind: 'files', client })
  try {
    const setup = spawnSync(bash, ['-c', String.raw`set -eu
export MSYS=winsymlinks:sys
mkdir -p releases/v1 releases/v2
mkdir -p releases/v1/child
touch "releases/owner's notes.txt"
ln -s releases/v1/ current
ln -s current chained
ln -s "releases/owner's notes.txt" file-link
ln -s missing broken
ln -s loop loop
ln -s /dev/null device
readlink --canonicalize-existing --zero -- .
`], { cwd: directory, encoding: 'utf8', timeout: 10_000 })
    assert.equal(setup.status, 0, setup.stderr)
    const remoteRoot = setup.stdout.slice(0, -1)
    const entries = await listRemoteDirectory(filesSession(sessionId).commands, remoteRoot)
    assert.deepEqual(entries.map(({ name, type, targetType }) => [name, type, targetType]), [
      ['releases', 'directory', undefined],
      ['broken', 'symlink', undefined], ['chained', 'symlink', 'directory'], ['current', 'symlink', 'directory'],
      ['device', 'symlink', undefined], ['file-link', 'symlink', 'file'], ['loop', 'symlink', undefined],
    ])
    /**
     * Looks up a navigation target within the test directory.
     * @param name Path relative to the fixture directory.
     * @returns The remote path and type.
     */
    const resolveTarget = (name: string) => resolveRemoteNavigationTarget(sessionId, `${remoteRoot}/${name}`)
    assert.deepEqual(await resolveTarget('releases/v1/'), { type: 'directory', path: `${remoteRoot}/releases/v1` })
    const regularFile = "releases/owner's notes.txt"
    assert.deepEqual(await resolveTarget(regularFile), { type: 'file', path: `${remoteRoot}/${regularFile}` })
    await assert.rejects(listRemoteDirectory(filesSession(sessionId).commands, `${remoteRoot}/${regularFile}`))
    for (const name of ['current', 'chained']) {
      assert.deepEqual(await resolveTarget(name), { type: 'directory', path: `${remoteRoot}/releases/v1` })
      const children = await listRemoteDirectory(filesSession(sessionId).commands, `${remoteRoot}/${name}/`)
      assert.deepEqual(children.map(({ name, path, type }) => ({ name, path, type })), [
        { name: 'child', path: `${remoteRoot}/${name}/child`, type: 'directory' },
      ])
    }
    const updated = spawnSync(bash, ['-c', 'export MSYS=winsymlinks:sys; ln -sfn releases/v2/ current'], { cwd: directory, encoding: 'utf8', timeout: 10_000 })
    assert.equal(updated.status, 0, updated.stderr)
    assert.deepEqual(await resolveTarget('current'), { type: 'directory', path: `${remoteRoot}/releases/v2` })
    assert.deepEqual(await resolveTarget('file-link'), { type: 'file', path: `${remoteRoot}/${regularFile}` })
    for (const name of ['missing', 'broken', 'loop']) await assert.rejects(resolveTarget(name), /无法访问目标路径/)
    await assert.rejects(resolveTarget('device'), /导航目标必须是普通文件或目录/)
  } finally {
    sessions.delete(sessionId)
    rmSync(directory, { recursive: true, force: true })
  }
})
