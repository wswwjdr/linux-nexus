import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { installTextSaveDependencies, missingTextSavePackages } from '../src/main/previews/text-save-dependencies.ts'
import { sessions } from '../src/main/runtime.ts'
import { RemoteCommandError } from '../src/main/ssh-commands.ts'

test('only accepts known package names from the save dependency result', () => {
  assert.deepEqual(missingTextSavePackages(new RemoteCommandError(74, 'LINUX_NEXUS_TEXT_DEPENDENCIES:acl attr\n')), ['acl', 'attr'])
  assert.equal(missingTextSavePackages(new RemoteCommandError(74, 'LINUX_NEXUS_TEXT_DEPENDENCIES:unknown\n')), undefined)
  assert.equal(missingTextSavePackages(new RemoteCommandError(1, 'LINUX_NEXUS_TEXT_DEPENDENCIES:attr\n')), undefined)
})

test('the installer sends the supplied password only after the sudo prompt and reports install errors', async () => {
  const sessionId = 'text-save-install'
  for (const { password, challenge, error } of [
    { password: undefined, challenge: true, error: 'sudo: no password was provided' },
    { password: 'test password', challenge: true, error: '' },
    { password: 'test password', challenge: false, error: '' },
    { password: 'test password', challenge: true, error: 'Package repository is unavailable' },
  ]) {
    const client = new EventEmitter() as Client
    const sent: string[] = []
    client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
      assert.match(command, /sudo -S -p/)
      assert.ok(command.endsWith("-- 'attr'"))
      if (password) assert.ok(!command.includes(password))
      const channel = new EventEmitter() as ClientChannel
      const stderr = new EventEmitter()
      Object.assign(channel, { stderr, write: (bytes: Buffer) => { sent.push(bytes.toString()); return true } })
      const complete = () => {
        if (error) stderr.emit('data', Buffer.from(error))
        channel.emit('exit', error ? 1 : 0)
        channel.emit('close', error ? 1 : 0)
      }
      Object.assign(channel, { end: () => { if (password || challenge) queueMicrotask(complete) } })
      queueMicrotask(() => {
        if (challenge) {
          assert.deepEqual(sent, [])
          stderr.emit('data', Buffer.from('LINUX_NEXUS_SUDO_'))
          stderr.emit('data', Buffer.from('PASSWORD:'))
        } else {
          complete()
        }
      })
      callback(undefined, channel)
      return client
    }
    sessions.set(sessionId, { sessionId, profileId: 'install-profile', kind: 'files', client })
    try {
      const result = installTextSaveDependencies(sessionId, ['attr'], password)
      if (password && error) await assert.rejects(result, { message: error })
      else assert.deepEqual(await result, { status: password ? 'installed' : 'password-required' })
      assert.deepEqual(sent, password && challenge ? [password + '\n'] : [])
    } finally {
      sessions.delete(sessionId)
    }
  }
})
