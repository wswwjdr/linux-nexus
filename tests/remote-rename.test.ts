import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { renameRemoteEntry } from '../src/main/remote-fs.ts'
import { sessions } from '../src/main/runtime.ts'
import { shellQuote } from '../src/shared/shell.ts'

function attachSession(failure = '') {
  const commands: string[] = []
  const client = new EventEmitter() as Client & EventEmitter
  client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
    commands.push(command)
    const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void }
    channel.stderr = new EventEmitter()
    channel.end = () => {
      if (failure) channel.stderr.emit('data', Buffer.from(failure))
      channel.emit('exit', failure ? 1 : 0)
      channel.emit('close', failure ? 1 : 0)
    }
    callback(undefined, channel as unknown as ClientChannel)
    return client
  }
  sessions.set('rename-session', { sessionId: 'rename-session', profileId: 'profile', kind: 'files', client })
  return commands
}

test('renames in the same parent with shell-safe arguments and no-clobber exact-target semantics', async () => {
  const commands = attachSession()
  try {
    const source = "/home/space ' quote\n中文; $(touch nope)"
    const name = " renamed ' name\n中文; $(touch nope) "
    const target = '/home/' + name
    assert.equal(await renameRemoteEntry('rename-session', source, name), target)
    assert.equal(commands.length, 1)
    assert.ok(commands[0].includes(shellQuote(source)))
    assert.ok(commands[0].includes(shellQuote(target)))
    assert.ok(commands[0].includes('mv -nT -- "$1" "$2"'))
    assert.ok(commands[0].includes('! -L "$1" && ( -f "$1" || -d "$1" )'))
    assert.ok(commands[0].includes('! -e "$2" && ! -L "$2"'))
    assert.ok(commands[0].includes('重命名未完成，目标名称可能已被占用'))
  } finally { sessions.delete('rename-session') }
})

test('rejects root, invalid paths and invalid basenames before opening an SSH channel', async () => {
  const commands = attachSession()
  try {
    for (const name of ['', '.', '..', '../escape', 'a/b', 'bad\0name']) {
      await assert.rejects(renameRemoteEntry('rename-session', '/home/a', name), /名称无效/)
    }
    for (const path of ['', 'bad\0path']) {
      await assert.rejects(renameRemoteEntry('rename-session', path, 'b'), /远程路径无效/)
    }
    await assert.rejects(renameRemoteEntry('rename-session', '/home/..', 'b'), /根目录/)
    assert.equal(await renameRemoteEntry('rename-session', '/home/a', 'a'), '/home/a')
    assert.equal(commands.length, 0)
  } finally { sessions.delete('rename-session') }
})

test('propagates collision and permission errors without a fallback move', async () => {
  for (const failure of ['同名文件或文件夹已存在', 'Permission denied']) {
    const commands = attachSession(failure)
    try {
      await assert.rejects(renameRemoteEntry('rename-session', '/home/a', 'b'), { message: failure })
      assert.equal(commands.length, 1)
    } finally { sessions.delete('rename-session') }
  }
})
