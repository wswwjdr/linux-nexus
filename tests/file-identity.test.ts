import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test, { type TestContext } from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { cancelFileRootEntry, enterFileRoot, fileCommands, initializeFileIdentity, leaveFileRoot, revokeFileIdentity } from '../src/main/file-identity.ts'
import { sessions, type ActiveSession } from '../src/main/runtime.ts'
import { executeRemoteOperation } from '../src/main/remote-operations.ts'

function attachSession(t: TestContext, sessionId: string, policy: () => 'password' | 'allow' | 'deny') {
  const client = new EventEmitter() as Client
  const commands: string[] = []
  const passwords: string[] = []
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    commands.push(command)
    const channel = new EventEmitter()
    const stderr = new EventEmitter()
    const prompt = command.match(/LINUX_NEXUS_SUDO_[\da-f-]+:/)?.[0]
    const ready = command.match(/LINUX_NEXUS_ROOT_[\da-f-]+\n/)?.[0]
    const complete = (code = 0) => {
      channel.emit('exit', code)
      channel.emit('close', code)
    }
    Object.assign(channel, {
      stderr,
      end: () => { if (!command.includes('long-running')) complete() },
      signal: () => complete(143),
      close: () => complete(143),
      write: (bytes: Buffer) => {
        passwords.push(bytes.toString())
        queueMicrotask(() => {
          if (bytes.toString() === 'valid\n') channel.emit('data', Buffer.from(ready!))
          else stderr.emit('data', Buffer.from(prompt!))
        })
        return true
      },
    })
    const access = policy()
    queueMicrotask(() => {
      if (!ready) return
      if (access === 'deny') {
        stderr.emit('data', Buffer.from('sudo: authorization denied'))
        complete(1)
      } else if (access === 'password') {
        stderr.emit('data', Buffer.from(prompt!))
      } else {
        channel.emit('data', Buffer.from(ready))
      }
    })
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  const session: ActiveSession = { sessionId, client, kind: 'files', profileId: 'server' }
  sessions.set(sessionId, session)
  t.after(async () => {
    sessions.delete(sessionId)
    await revokeFileIdentity(session)
  })
  return { session, commands, passwords }
}

test('sudo applies only to its file tab, and revoked work cannot continue as the login user', async (t) => {
  const left = attachSession(t, 'left', () => 'password')
  const right = attachSession(t, 'right', () => 'allow')
  const oldScope = fileCommands(left.session)
  assert.deepEqual(await enterFileRoot('left'), { status: 'password-required' })
  await assert.rejects(enterFileRoot('left', 'invalid'), /sudo 密码错误/)
  assert.equal(fileCommands(left.session), oldScope)
  assert.deepEqual(await enterFileRoot('left', 'valid'), { status: 'entered', identity: 'sudo-root' })
  const root = fileCommands(left.session)
  assert.ok(oldScope.signal.aborted)
  await assert.rejects(oldScope.execute('stale-command'), { name: 'AbortError' })
  await root.execute('copy-command')
  await fileCommands(right.session).execute('list-command')
  assert.match(left.commands.at(-1)!, /sudo.*copy-command/s)
  assert.deepEqual(left.passwords, ['invalid\n', 'valid\n', 'valid\n'])
  assert.deepEqual(right.commands, ['list-command'])
  const pending = root.execute('long-running')
  await Promise.resolve()
  assert.deepEqual(await leaveFileRoot('left'), { remoteStateUnknown: false })
  await assert.rejects(pending, { name: 'AbortError' })
  await assert.rejects(root.execute('stale-root-command'), { name: 'AbortError' })
  await fileCommands(left.session).execute('normal-command')
  assert.equal(left.commands.at(-1), 'normal-command')
})

test('a root request waits for whole file work and can be cancelled while waiting', async (t) => {
  const { session, commands } = attachSession(t, 'waiting', () => 'allow')
  const ordinary = fileCommands(session)
  let release!: () => void
  const work = ordinary.track(new Promise<void>((resolve) => { release = resolve }))
  const attempt = enterFileRoot(session.sessionId)
  assert.throws(() => fileCommands(session), /正在切换/)
  assert.deepEqual(commands, [])
  cancelFileRootEntry(session.sessionId)
  assert.deepEqual(await attempt, { status: 'cancelled' })
  const second = enterFileRoot(session.sessionId)
  await ordinary.execute('preflight-finishes')
  assert.deepEqual(commands, ['preflight-finishes'])
  release()
  await work
  assert.deepEqual(await second, { status: 'entered', identity: 'sudo-root' })
})

test('sudo denial clears the elevated scope, and direct root login never invokes sudo', async (t) => {
  let policy: 'allow' | 'deny' = 'allow'
  const { session } = attachSession(t, 'expiry', () => policy)
  await enterFileRoot(session.sessionId)
  const elevated = fileCommands(session)
  policy = 'deny'
  await assert.rejects(elevated.execute('read-protected-file'), /authorization denied/)
  assert.ok(elevated.signal.aborted)
  await fileCommands(session).execute('read-as-login-user')
  const direct = attachSession(t, 'direct', () => 'deny')
  assert.equal(initializeFileIdentity(direct.session, 0), 'root-login')
  assert.deepEqual(await enterFileRoot(direct.session.sessionId), { status: 'entered', identity: 'root-login' })
  await fileCommands(direct.session).execute('read-as-root')
  assert.deepEqual(direct.commands, ['read-as-root'])
})

test('copy, move and extraction keep their native commands in an elevated file session', async (t) => {
  const { session, commands } = attachSession(t, 'file-operations', () => 'allow')
  await enterFileRoot(session.sessionId)
  for (const operation of ['copy', 'move', 'extract'] as const) {
    const result = await executeRemoteOperation({
      sessionId: session.sessionId,
      requestId: operation,
      operation,
      sourcePaths: operation === 'extract' ? [] : ['/source/file'],
      targetDirectory: '/root/private',
      strategy: 'force',
      ...(operation === 'extract' ? { archivePath: '/source/archive.tar', wrapInDirectory: false } : {}),
    })
    assert.equal(result.status, 'completed')
    const utility = { copy: 'cp -R', move: 'mv -f', extract: 'tar --no-same-owner' }[operation]
    assert.ok(result.command.includes(utility))
    assert.ok(commands.at(-1)?.startsWith('exec /usr/bin/sudo '))
    assert.ok(commands.at(-1)?.includes(utility))
  }
})
