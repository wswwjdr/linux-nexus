import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import type { BrowserWindow } from 'electron'
import type { Client, ClientChannel } from 'ssh2'
import { buildContentSearchScript, cancelContentSearch, startContentSearch } from '../src/main/content-search.ts'
import { buildNameSearchCommand, cancelNameSearch, startNameSearch } from '../src/main/name-search.ts'
import { setMainWindow, sessions } from '../src/main/runtime.ts'
import type { ContentSearchEvent, ContentSearchRequest, NameSearchEvent, NameSearchRequest } from '../src/shared/types.ts'

class SearchChannel extends EventEmitter {
  stderr = new EventEmitter()
  closeCalls = 0

  close(): void {
    this.closeCalls += 1
  }
}

function setupSearch(requestId: string) {
  const channel = new SearchChannel()
  const events: Array<NameSearchEvent | ContentSearchEvent> = []
  const commands: string[] = []
  const sessionId = 'session-' + requestId
  const profileId = 'profile-' + requestId
  const client = {
    exec: (command: string, callback: (error: Error | undefined, stream: ClientChannel) => void) => {
      commands.push(command)
      callback(undefined, channel as unknown as ClientChannel)
    },
  } as unknown as Client
  sessions.set(sessionId, {
    sessionId,
    client,
    kind: 'files',
    profileId,
  })
  setMainWindow({
    isDestroyed: () => false,
    webContents: { send: (_channel: string, event: NameSearchEvent | ContentSearchEvent) => events.push(event) },
  } as unknown as BrowserWindow)
  const nameRequest: NameSearchRequest = {
    requestId,
    sessionId,
    profileId,
    rootPath: '/',
    query: 'start.sh',
    matchMode: 'exact',
    ignoreCase: true,
  }
  const contentRequest: ContentSearchRequest = {
    requestId,
    sessionId,
    profileId,
    rootPath: '/',
    query: 'needle',
    ignoreCase: true,
    maxFileSizeMiB: 1,
  }
  return {
    channel,
    events,
    commands,
    nameRequest,
    contentRequest,
    cleanup: () => {
      sessions.delete(sessionId)
      setMainWindow(null)
    },
  }
}

function record(channel: SearchChannel, ...fields: string[]): void {
  channel.emit('data', Buffer.from(fields.join('\0') + '\0'))
}

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64')
}

function finishChannel(channel: SearchChannel, exitCode = 0): void {
  channel.emit('exit', exitCode)
  channel.emit('close')
}

test('filename command matches terminal find semantics and quotes literal glob characters', () => {
  const setup = setupSearch('name-command')
  try {
    assert.equal(buildNameSearchCommand(setup.nameRequest), "find -- '/' -type f -iname 'start.sh' -print0")
    assert.equal(buildNameSearchCommand({
      ...setup.nameRequest,
      rootPath: '/srv/files',
      query: 'a*b?[x]\\z',
      matchMode: 'contains',
      ignoreCase: false,
    }), "find -- '/srv/files' -type f -name '*a\\*b\\?\\[x\\]\\\\z*' -print0")
  } finally {
    setup.cleanup()
  }
})

test('filename search streams all NUL-separated matches and preserves unusual paths', () => {
  const setup = setupSearch('name-stream')
  const unusualPath = '/docs/start.sh\n[x]'
  try {
    startNameSearch(setup.nameRequest)
    setup.channel.emit('data', Buffer.concat([
      Buffer.from('/website/start.sh\0', 'utf8'),
      Buffer.from(unusualPath + '\0', 'utf8'),
    ]))
    finishChannel(setup.channel)

    assert.equal(setup.commands[0], "find -- '/' -type f -iname 'start.sh' -print0")
    const results = setup.events.filter((event) => event.type === 'results').flatMap((event) => event.results)
    assert.deepEqual(results.map(({ path }) => path), ['/website/start.sh', unusualPath])
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.matchedFiles, 2)
  } finally {
    setup.cleanup()
  }
})

test('filename search streams more than 100 matches without truncation', () => {
  const setup = setupSearch('name-many-results')
  const paths = Array.from({ length: 137 }, (_, index) => `/files/${index}.txt`)
  try {
    startNameSearch(setup.nameRequest)
    setup.channel.emit('data', Buffer.from(paths.join('\0') + '\0', 'utf8'))
    finishChannel(setup.channel)

    const batches = setup.events.filter((event) => event.type === 'results')
    const results = batches.flatMap((event) => event.results)
    assert.equal(results.length, paths.length)
    assert.deepEqual(results.map(({ path }) => path), paths)
    assert.ok(batches.length > 1)
    assert.equal(setup.events.find((event) => event.type === 'finished')?.matchedFiles, paths.length)
  } finally {
    setup.cleanup()
  }
})

test('filename search reports traversal errors while keeping partial matches', () => {
  const setup = setupSearch('name-errors')
  try {
    startNameSearch(setup.nameRequest)
    setup.channel.emit('data', Buffer.from('/root/start.sh\0'))
    setup.channel.stderr.emit('data', Buffer.from("find: '/restricted': Permission denied\n"))
    finishChannel(setup.channel, 1)

    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.incomplete, true)
    assert.equal(finished?.hasReadErrors, true)
  } finally {
    setup.cleanup()
  }
})

test('filename search retains streamed matches and reports an SSH interruption', () => {
  const setup = setupSearch('name-interrupted')
  try {
    startNameSearch(setup.nameRequest)
    setup.channel.emit('data', Buffer.from('/root/start.sh\0'))
    setup.channel.emit('close')

    const results = setup.events.filter((event) => event.type === 'results').flatMap((event) => event.results)
    assert.deepEqual(results.map(({ path }) => path), ['/root/start.sh'])
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'failed')
    assert.match(finished?.message ?? '', /SSH 连接中断/)
  } finally {
    setup.cleanup()
  }
})

test('filename search validates normalized absolute custom roots', () => {
  const setup = setupSearch('name-invalid-root')
  try {
    assert.throws(() => startNameSearch({ ...setup.nameRequest, rootPath: '/var/../etc' }), /规范化的绝对远端路径/)
    assert.throws(() => startNameSearch({ ...setup.nameRequest, rootPath: 'etc' }), /规范化的绝对远端路径/)
    assert.throws(() => startNameSearch({ ...setup.nameRequest, requestId: 'bad\nid' }), /文件名搜索条件无效/)
    assert.throws(() => startNameSearch({ ...setup.nameRequest, sessionId: 'bad\0session' }), /文件名搜索条件无效/)
    assert.throws(() => startNameSearch({ ...setup.nameRequest, profileId: 'p'.repeat(129) }), /文件名搜索条件无效/)
    assert.throws(() => startNameSearch({ ...setup.nameRequest, rootPath: '/bad\npath' }), /文件名搜索条件无效/)
  } finally {
    setup.cleanup()
  }
})

test('filename cancellation closes its SSH channel once and emits a cancelled event', () => {
  const setup = setupSearch('name-cancel')
  try {
    startNameSearch(setup.nameRequest)
    assert.equal(cancelNameSearch(setup.nameRequest.requestId), true)
    assert.equal(setup.channel.closeCalls, 1)
    assert.equal(setup.events.find((event) => event.type === 'finished')?.status, 'cancelled')
  } finally {
    setup.cleanup()
  }
})

test('content search uses one find traversal and fixed-string grep with the chosen case option', () => {
  const setup = setupSearch('content-command')
  try {
    const script = buildContentSearchScript()
    assert.match(script, /find -- "\$root" -type f -printf '%s\\0%p\\0'/)
    assert.match(script, /grep_flags=\(-F -H -n -C 1 -Z --no-group-separator\)/)
    assert.match(script, /grep "\$\{grep_flags\[@\]\}" -- "\$query" "\$\{batch_paths\[@\]\}"/)
    assert.match(script, /#batch_paths\[@\]\} >= 64/)
    assert.match(script, /size > limit_bytes/)
    assert.match(script, /grep_flags\+=\(-i\)/)
    assert.doesNotMatch(script, /--extended-regexp|--perl-regexp/)
    assert.equal((script.match(/find -- "\$root"/g) ?? []).length, 1)
    assert.doesNotMatch(script, /inventory|matchedFiles.*100|RESULT_LIMIT/)
    startContentSearch(setup.contentRequest)
    assert.match(setup.commands[0], /'needle' '1' '1048576'$/)
    assert.equal(cancelContentSearch(setup.contentRequest.requestId), true)
    startContentSearch({ ...setup.contentRequest, ignoreCase: false })
    assert.match(setup.commands[1], /'needle' '0' '1048576'$/)
    assert.match(setup.commands[1], /grep_flags=\(-F -H -n -C 1 -Z --no-group-separator\)/)
    assert.equal(cancelContentSearch(setup.contentRequest.requestId), true)
  } finally {
    setup.cleanup()
  }
})

test('content protocol reconstructs matching lines and adjacent context from one streamed result', () => {
  const setup = setupSearch('content-result')
  const path = '/docs/notes file.txt'
  try {
    startContentSearch(setup.contentRequest)
    record(setup.channel,
      'R', '31', base64(path),
      'L', base64('1-before'),
      'L', base64('2:Needle found'),
      'L', base64('3-after'),
      'Z',
      'P', '1', '31', '1', '1', '0', '0', '0', base64(path),
      'D', '1', '31', '1', '1', '0', '0', '0',
    )
    finishChannel(setup.channel)

    const results = setup.events.filter((event) => event.type === 'results').flatMap((event) => event.results)
    assert.deepEqual(results[0], {
      name: 'notes file.txt',
      path,
      type: 'file',
      size: 31,
      matches: [{
        lineNumber: 2,
        before: { lineNumber: 1, text: 'before' },
        text: 'Needle found',
        after: { lineNumber: 3, text: 'after' },
      }],
    })
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.matchedLines, 1)
  } finally {
    setup.cleanup()
  }
})

test('content results preserve newline paths and keep matches when another file has a read error', () => {
  const setup = setupSearch('content-special-path')
  const path = '/docs/line\nbreak.txt'
  try {
    startContentSearch(setup.contentRequest)
    record(setup.channel,
      'R', '12', base64(path),
      'L', base64('2:needle here'),
      'Z',
      'P', '2', '24', '1', '1', '0', '0', '1', base64('/docs/unreadable.txt'),
      'D', '2', '24', '1', '1', '0', '0', '1',
    )
    finishChannel(setup.channel, 1)

    const result = setup.events.filter((event) => event.type === 'results').flatMap((event) => event.results)[0]
    assert.equal(result?.path, path)
    assert.equal(result?.matches[0]?.text, 'needle here')
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.readErrors, 1)
    assert.equal(finished?.incomplete, true)
  } finally {
    setup.cleanup()
  }
})

test('content search validates custom roots, query control characters, and the file-size ceiling', () => {
  const setup = setupSearch('content-invalid-input')
  try {
    assert.throws(() => startContentSearch({ ...setup.contentRequest, rootPath: '/var/../etc' }), /规范化的绝对远端路径/)
    assert.throws(() => startContentSearch({ ...setup.contentRequest, query: 'line\nbreak' }), /文本内容搜索条件无效/)
    assert.throws(() => startContentSearch({ ...setup.contentRequest, maxFileSizeMiB: 102401 }), /文本内容搜索条件无效/)
    assert.throws(() => startContentSearch({ ...setup.contentRequest, requestId: 'bad\0id' }), /文本内容搜索条件无效/)
    assert.throws(() => startContentSearch({ ...setup.contentRequest, rootPath: '/bad\rpath' }), /文本内容搜索条件无效/)
  } finally {
    setup.cleanup()
  }
})

test('content search reports oversized files, binary matches, and read errors independently', () => {
  const setup = setupSearch('content-progress')
  try {
    startContentSearch(setup.contentRequest)
    record(setup.channel, 'P', '2', '100', '0', '0', '3', '1', '2', base64('/docs/current'))
    record(setup.channel, 'D', '2', '100', '0', '0', '3', '1', '2')
    finishChannel(setup.channel)
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'completed')
    assert.equal(finished?.skippedLargeFiles, 3)
    assert.equal(finished?.skippedBinaryFiles, 1)
    assert.equal(finished?.readErrors, 2)
    assert.equal(finished?.incomplete, true)
  } finally {
    setup.cleanup()
  }
})

test('content cancellation closes the SSH channel and retains the current progress', () => {
  const setup = setupSearch('content-cancel')
  try {
    startContentSearch(setup.contentRequest)
    assert.equal(cancelContentSearch(setup.contentRequest.requestId), true)
    assert.equal(setup.channel.closeCalls, 1)
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'cancelled')
    assert.equal(finished?.processedFiles, 0)
  } finally {
    setup.cleanup()
  }
})

test('content search retains streamed matches and reports an SSH interruption', () => {
  const setup = setupSearch('content-interrupted')
  const path = '/docs/notes.txt'
  try {
    startContentSearch(setup.contentRequest)
    record(setup.channel, 'R', '31', base64(path), 'L', base64('2:needle'), 'Z')
    setup.channel.emit('close')

    const results = setup.events.filter((event) => event.type === 'results').flatMap((event) => event.results)
    assert.equal(results[0]?.path, path)
    assert.equal(results[0]?.matches[0]?.text, 'needle')
    const finished = setup.events.find((event) => event.type === 'finished')
    assert.equal(finished?.status, 'failed')
    assert.match(finished?.message ?? '', /SSH 连接中断/)
  } finally {
    setup.cleanup()
  }
})
