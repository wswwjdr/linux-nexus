import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { cancelDependencies, createDependencyPlan, installDependencies, recheckDependencies, skipArchivePreparation, type DependencyContext } from '../src/main/dependency-plans.ts'
import type { CapabilityReport, ServerEnvironment } from '../src/main/server-capabilities.ts'

class Channel extends EventEmitter {
  stderr = new EventEmitter()
  received: string[] = []
  end() {}
  close() {}
  signal() { this.emit('close', null) }
  write(bytes: Buffer) { this.received.push(bytes.toString()); return true }
  complete(code: number) { this.emit('exit', code); this.emit('close', code) }
}

/** Simulates a trusted SSH channel and mutable capability report for a dependency flow. */
function fixture(uid = 0, endpoint = 'test:22') {
  const client = new EventEmitter() as Client
  const commands: string[] = []
  const channels: Channel[] = []
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    const channel = new Channel()
    commands.push(command)
    channels.push(channel)
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  const controller = new AbortController()
  const environment: ServerEnvironment = { distribution: { id: 'ubuntu', like: [] }, effectiveUid: uid, canSudo: true,
    managers: ['apt-get'], base: { missing: [], incompatible: [] } }
  let report: CapabilityReport = { missing: ['getfattr'], incompatible: [] }
  const context: DependencyContext = { sessionId: crypto.randomUUID(), endpoint, client, signal: controller.signal, purpose: 'text-save',
    inspect: async () => ({ environment, report }) }
  const issue = createDependencyPlan(context, { environment, report })
  return { issue, client, commands, channels, controller, context, environment, ready: () => { report = { missing: [], incompatible: [] } } }
}

test('installs only the proposed packages, locks the endpoint and then rechecks', async () => {
  const first = fixture()
  const second = fixture()
  try {
    assert.deepEqual(first.issue.packages, ['attr'])
    assert.deepEqual(first.commands, [])
    const install = installDependencies(first.issue.id, undefined)
    assert.match(first.commands[0], /\/usr\/bin\/apt-get/)
    assert.match(first.commands[0], /'attr'$/)
    await assert.rejects(installDependencies(second.issue.id, undefined), /任务|progress/)
    first.ready()
    first.channels[0].complete(0)
    assert.deepEqual(await install, { status: 'installed' })
    assert.deepEqual(await recheckDependencies(first.issue.id), { status: 'ready' })
    await assert.rejects(recheckDependencies(first.issue.id), /失效|expired/)
  } finally { cancelDependencies(first.issue.id); cancelDependencies(second.issue.id) }
})

test('sends the secret only after the matching sudo prompt and reports a repository failure', async () => {
  const remote = fixture(1000)
  try {
    const initial = installDependencies(remote.issue.id, undefined)
    const prompt = /LINUX_NEXUS_SUDO_[\w-]+:/.exec(remote.commands[0])![0]
    remote.channels[0].stderr.emit('data', Buffer.from(prompt))
    assert.deepEqual(await initial, { status: 'password-required' })
    assert.deepEqual(remote.channels[0].received, [])

    const attempt = installDependencies(remote.issue.id, 'secret')
    const command = remote.commands[1]
    const challenge = /LINUX_NEXUS_SUDO_[\w-]+:/.exec(command)![0]
    const ready = /LINUX_NEXUS_ROOT_[\w-]+\n/.exec(command)![0]
    const channel = remote.channels[1]
    assert.doesNotMatch(command, /secret/)
    channel.stderr.emit('data', Buffer.from(challenge.slice(0, 10)))
    assert.deepEqual(channel.received, [])
    channel.stderr.emit('data', Buffer.from(challenge.slice(10)))
    assert.deepEqual(channel.received, ['secret\n'])
    channel.emit('data', Buffer.from(ready))
    channel.stderr.emit('data', Buffer.from('Repository unavailable'))
    channel.complete(1)
    await assert.rejects(attempt, /Repository unavailable/)
    const recheck = await recheckDependencies(remote.issue.id)
    assert.equal(recheck.status, 'missing')
    if (recheck.status === 'missing') assert.deepEqual(recheck.issue.packages, [])
    await assert.rejects(installDependencies(remote.issue.id, undefined))
  } finally { cancelDependencies(remote.issue.id) }
})

test('cancels unconfirmed and disconnected plans and supports manual recheck without installation', async () => {
  const cancelled = fixture()
  cancelDependencies(cancelled.issue.id)
  await assert.rejects(installDependencies(cancelled.issue.id, undefined))
  assert.deepEqual(cancelled.commands, [])

  const disconnected = fixture()
  disconnected.controller.abort()
  await assert.rejects(recheckDependencies(disconnected.issue.id))

  const manual = fixture()
  manual.environment.managers = []
  const check = await recheckDependencies(manual.issue.id)
  assert.equal(check.status, 'missing')
  if (check.status === 'missing') assert.deepEqual(check.issue.packages, [])
  manual.ready()
  assert.deepEqual(await recheckDependencies(manual.issue.id), { status: 'ready' })
  assert.deepEqual(manual.commands, [])
})

test('successful package installation still stops when capabilities are missing', async () => {
  const remote = fixture()
  try {
    const install = installDependencies(remote.issue.id, undefined)
    remote.channels[0].complete(0)
    assert.deepEqual(await install, { status: 'installed' })
    const result = await recheckDependencies(remote.issue.id)
    assert.equal(result.status, 'missing')
    if (result.status === 'missing') {
      assert.deepEqual(result.issue.missing, ['getfattr'])
      assert.deepEqual(result.issue.packages, [])
    }
  } finally { cancelDependencies(remote.issue.id) }
})

test('losing the connection during installation reports unknown state and invalidates the plan', async () => {
  const remote = fixture()
  const attempt = installDependencies(remote.issue.id, undefined)
  remote.controller.abort()
  await assert.rejects(attempt, /无法确认|could not be confirmed/)
  await assert.rejects(installDependencies(remote.issue.id, undefined), /失效|expired/)
})

test('connection activation waits until a recheck passes', async () => {
  const remote = fixture()
  cancelDependencies(remote.issue.id)
  let activated = 0
  const issue = createDependencyPlan({
    ...remote.context, purpose: 'connection',
    onReady: () => { activated += 1; return { status: 'ready', fileIdentity: 'root-login' } },
  }, { environment: remote.environment, report: { missing: ['bash'], incompatible: [] } })
  try {
    const installation = installDependencies(issue.id, undefined)
    remote.channels[0].complete(0)
    assert.deepEqual(await installation, { status: 'installed' })
    assert.equal(activated, 0)
    remote.ready()
    assert.deepEqual(await recheckDependencies(issue.id), { status: 'ready', fileIdentity: 'root-login' })
    assert.equal(activated, 1)
  } finally { cancelDependencies(issue.id) }
})

test('optional archive preparation reports affected formats and skipping activates without installing', async () => {
  const remote = fixture()
  cancelDependencies(remote.issue.id)
  let entered = 0
  const issue = createDependencyPlan({
    ...remote.context, purpose: 'archive-setup',
    onSkip: () => { entered++; return { status: 'ready', fileIdentity: 'root-login' } },
  }, { environment: remote.environment, report: { missing: ['unzip'], incompatible: ['tar'] } })
  assert.deepEqual(issue.formats, ['zip', 'tar', 'tar-gz', 'tar-bz2', 'tar-xz', 'tar-zst'])
  assert.deepEqual(issue.packages, ['unzip'])
  assert.deepEqual(skipArchivePreparation(issue.id), { status: 'ready', fileIdentity: 'root-login' })
  assert.equal(entered, 1)
  assert.deepEqual(remote.commands, [])
  await assert.rejects(installDependencies(issue.id, undefined))
})
