import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client, ClientChannel } from 'ssh2'
import { previewResponse } from '../src/main/preview-protocol'
import { registerMarkdownResources, releasePreview, clearPreviewAssetsForSession, getPreviewAsset } from '../src/main/previews/preview-assets'
import { sessions } from '../src/main/runtime'
import { configureStateFiles } from '../src/main/state-store'
import { defaultAppSettings } from '../src/shared/app-settings'
import { shellQuote } from '../src/shared/shell'

test('Markdown resource protocol validates file contracts, honors byte ranges and revokes active reads with the document', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-markdown-resources-'))
  const settings = { ...defaultAppSettings(), imageMiB: 1 }
  await writeFile(join(directory, 'settings.json'), JSON.stringify(settings))
  configureStateFiles(join(directory, 'servers.json'), join(directory, 'settings.json'))
  const commands: string[] = [], signals: string[] = []
  const client = new EventEmitter() as Client
  client.exec = ((command: string, callback: (error: undefined, channel: ClientChannel) => void) => {
    commands.push(command)
    const channel = new EventEmitter() as ClientChannel
    channel.stderr = new EventEmitter() as ClientChannel['stderr']
    const complete = (stdout: Buffer | string, code = 0) => {
      channel.emit('data', Buffer.from(stdout)); channel.emit('exit', code); channel.emit('close', code)
    }
    channel.end = (() => {
      queueMicrotask(() => {
        if (command.includes('denied.png')) { channel.stderr.emit('data', Buffer.from('permission denied')); complete('', 1) }
        else if (command.includes('stat -c %s')) complete(command.includes('huge.png') ? '2000000' : '6')
        else if (command.includes('if [[ -L')) complete(command.includes('symlink.png') ? 'l' : 'f')
        else if (command.includes('slow.png')) channel.emit('data', Buffer.from('abc'))
        else complete(command.includes(shellQuote('2')) && command.includes(shellQuote('3')) ? 'cde' : 'abcdef')
      })
      return channel
    }) as ClientChannel['end']
    channel.pause = (() => channel) as ClientChannel['pause']
    channel.resume = (() => channel) as ClientChannel['resume']
    channel.signal = ((signal: string) => { signals.push(signal); queueMicrotask(() => { channel.emit('exit', 143); channel.emit('close', 143) }) }) as ClientChannel['signal']
    channel.close = (() => { channel.emit('close', 143); return channel }) as ClientChannel['close']
    channel.destroy = (() => { channel.emit('close', 143); return channel }) as ClientChannel['destroy']
    callback(undefined, channel)
    return client
  }) as Client['exec']
  sessions.set('md-session', { sessionId: 'md-session', profileId: 'server', kind: 'files', client })
  const request = (path: string, init?: RequestInit) => previewResponse(new Request('remote-preview://document' + path, init))
  registerMarkdownResources('document', 'md-session', 'server')
  try {
    let response = await request('/docs/%E5%9B%BE%E7%89%87%20a.png')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(await response.text(), 'abcdef')
    assert.ok(commands.some((command) => command.includes(shellQuote('/docs/图片 a.png'))))
    response = await request('/docs/a.png', { headers: { Range: 'bytes=2-4' } })
    assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), 'bytes 2-4/6')
    assert.equal(await response.text(), 'cde')
    assert.equal((await request('/docs/a.png', { method: 'HEAD' })).status, 200)
    assert.equal((await request('/docs/a.png', { headers: { Range: 'bytes=9-12' } })).status, 416)
    assert.equal((await request('/docs/a.png', { method: 'POST' })).status, 405)
    assert.equal((await request('/docs/%00.png')).status, 400)
    assert.equal((await request('/docs/%XX.png')).status, 400)
    assert.equal((await request('/etc/passwd')).status, 415)
    assert.equal((await request('/docs/huge.png')).status, 413)
    assert.equal((await request('/docs/symlink.png')).status, 404)
    assert.equal((await request('/docs/denied.png')).status, 502)
    sessions.set('md-session', { sessionId: 'md-session', profileId: 'another-server', kind: 'files', client })
    assert.equal((await request('/docs/a.png')).status, 503)
    sessions.set('md-session', { sessionId: 'md-session', profileId: 'server', kind: 'files', client })
    const stream = await request('/docs/slow.png')
    const reader = stream.body!.getReader()
    assert.equal(new TextDecoder().decode((await reader.read()).value), 'abc')
    await releasePreview('document')
    await reader.read().catch(() => {})
    assert.equal(getPreviewAsset('document'), undefined)
    assert.equal((await request('/docs/a.png')).status, 404)
    assert.ok(signals.includes('TERM'))
    registerMarkdownResources('document', 'md-session', 'server')
    clearPreviewAssetsForSession('md-session')
    assert.equal((await request('/docs/a.png')).status, 404)
  } finally {
    clearPreviewAssetsForSession('md-session'); sessions.delete('md-session')
    await rm(directory, { recursive: true, force: true })
  }
})
