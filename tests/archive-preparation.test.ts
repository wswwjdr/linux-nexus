import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { listDirectory } from '../src/main/connections.ts'
import { sessions } from '../src/main/runtime.ts'
import { archivePreparationKey, archivePreparationSeen, configureStateFiles, saveArchivePreparation } from '../src/main/state-store.ts'

test('archive preparation is recorded only after the first successful listing for the verified profile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-archive-preparation-'))
  configureStateFiles(join(directory, 'servers.json'), join(directory, 'settings.json'))
  const profile = { id: 'profile', name: 'Server', host: 'server', port: 22, username: 'login', pinned: false }
  const key = archivePreparationKey(profile, 'fingerprint')
  const platform = { endpoint: 'server:22', pendingArchivePreparation: key, environment: {
    distribution: { like: [] }, effectiveUid: 1000, managers: [], canSudo: false, base: { missing: [], incompatible: [] },
  } }
  const client = new EventEmitter() as Client
  let exitCode = 1
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    assert.match(command, /find -- \./)
    const channel = new EventEmitter() as ClientChannel
    Object.assign(channel, { stderr: new EventEmitter(), end: () => { channel.emit('exit', exitCode); channel.emit('close', exitCode) } })
    callback(undefined, channel)
    return client
  }
  sessions.set('first', { sessionId: 'first', profileId: profile.id, kind: 'files', client, platform })
  try {
    assert.equal(archivePreparationSeen(profile.id, key), false)
    await assert.rejects(listDirectory('first', '/'))
    assert.equal(archivePreparationSeen(profile.id, key), false)
    exitCode = 0
    assert.deepEqual(await listDirectory('first', '/'), [])
    assert.equal(archivePreparationSeen(profile.id, key), true)
    configureStateFiles(join(directory, 'servers.json'), join(directory, 'settings.json'))
    assert.equal(archivePreparationSeen(profile.id, key), true)
    const changedKeys = [
      archivePreparationKey({ ...profile, username: 'root' }, 'fingerprint'),
      archivePreparationKey({ ...profile, host: 'new-server' }, 'fingerprint'),
      archivePreparationKey({ ...profile, port: 2222 }, 'fingerprint'),
      archivePreparationKey(profile, 'new-fingerprint'),
    ]
    for (const changed of changedKeys) assert.equal(archivePreparationSeen(profile.id, changed), false)
    saveArchivePreparation(profile.id)
    assert.equal(archivePreparationSeen(profile.id, key), false)
  } finally {
    sessions.delete('first')
    await rm(directory, { recursive: true, force: true })
  }
})
