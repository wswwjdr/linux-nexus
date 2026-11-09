import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, Fragment, useState } from 'react'
import { JSDOM } from 'jsdom'
import type { RemoteDirectoryStats, RemoteDirectoryUsageNode, RemoteEntryProperties, RemoteFilesApi } from '../src/shared/types.ts'
import { setLanguage } from '../src/shared/i18n/messages.ts'
import RemoteEntryPropertiesDialog from '../src/renderer/src/components/RemoteEntryPropertiesDialog.tsx'
import SearchDialog from '../src/renderer/src/features/search/SearchDialog.tsx'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
})
const file: RemoteEntryProperties = {
  name: 'notes.txt', path: '/notes.txt', type: 'file', size: 1234, permissions: '644', symbolicPermissions: '-rw-r--r--',
  owner: 'alice', uid: 1000, group: 'staff', gid: 1001, accessedAt: '2026-10-01T12:00:00Z',
  modifiedAt: '2026-10-02T12:00:00Z', changedAt: '2026-10-03T12:00:00Z', createdAt: null, linkTarget: null,
}
const emptyStats: RemoteDirectoryStats = { allocatedBytes: 4096, directoryCount: 0, fileCount: 0 }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function mount(api: Pick<RemoteFilesApi, 'getRemoteEntryProperties' | 'getRemoteDirectoryStats'> &
  Partial<Pick<RemoteFilesApi, 'getRemoteDirectoryUsageTree' | 'cancelRemoteDirectoryUsageTree'>>) {
  const { createRoot } = await import('react-dom/client')
  Object.defineProperty(window, 'remoteFiles', { configurable: true, value: api })
  const host = document.createElement('div')
  const anchor = document.createElement('button')
  document.body.append(anchor, host)
  const root = createRoot(host)
  let closed = 0
  const render = async (sessionId: string, path: string) => {
    await act(async () => root.render(createElement(RemoteEntryPropertiesDialog, { sessionId, path, returnFocus: anchor, onClose: () => { closed++ } })))
  }
  await render('session-a', '/notes.txt')
  return {
    host, anchor, render, get closed() { return closed },
    button(label: string) { return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent === label)! },
    async click(label: string) { await act(async () => { this.button(label).click() }) },
    escape() { act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))) },
    unmount() { act(() => root.unmount()); host.remove(); anchor.remove() },
  }
}

test('shows loading then fresh read-only metadata, focuses and traps focus, and dismisses normally', async () => {
  const pending = deferred<RemoteEntryProperties>()
  const calls: unknown[] = []
  const view = await mount({
    getRemoteEntryProperties: async (...args) => { calls.push(args); return pending.promise },
    getRemoteDirectoryStats: async () => { throw new Error('must be on demand') },
  })
  try {
    assert.match(view.host.textContent!, /正在读取/)
    assert.equal(document.activeElement?.getAttribute('aria-label'), '关闭')
    await act(async () => pending.resolve(file))
    assert.deepEqual(calls, [['session-a', '/notes.txt']])
    for (const label of ['notes.txt', '/notes.txt', '1,234 字节', '644（-rw-r--r--）', 'alice（UID: 1000）', 'staff（GID: 1001）', '访问时间', '修改时间', '元数据变更时间']) assert.ok(view.host.textContent!.includes(label), label)
    assert.ok(!view.host.textContent!.includes('创建时间'))
    assert.equal(view.host.querySelector('input'), null)
    assert.equal(view.button('计算占用空间'), undefined)
    assert.equal(view.button('计算详细空间（树展示）'), undefined)
    const last = view.button('关闭')
    act(() => { last.focus(); last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })) })
    assert.equal(document.activeElement?.getAttribute('aria-label'), '关闭')
    view.escape()
    assert.equal(view.closed, 1)
    await view.click('关闭')
    act(() => view.host.querySelector('.modal-backdrop')!.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true })))
    assert.equal(view.closed, 3)
  } finally { view.unmount() }
})

test('metadata errors can be retried and symlinks display their own size, target and available creation date', async () => {
  let calls = 0
  const view = await mount({
    getRemoteEntryProperties: async () => {
      if (++calls === 1) throw new Error('No such file or directory')
      return { ...file, type: 'symlink', size: 9, linkTarget: '../target\n中文', createdAt: file.accessedAt }
    },
    getRemoteDirectoryStats: async () => emptyStats,
  })
  try {
    assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /No such file/)
    await view.click('重试读取')
    assert.equal(calls, 2)
    assert.match(view.host.textContent!, /符号链接/)
    assert.match(view.host.textContent!, /9 字节/)
    assert.match(view.host.textContent!, /链接目标.*\.\.\/target\n中文/)
    assert.match(view.host.textContent!, /创建时间/)
    assert.equal(view.host.querySelector('[role="alert"]'), null)
  } finally { view.unmount() }
})

test('directory statistics are on demand, block duplicate requests and can be retried after timeout', async () => {
  const first = deferred<RemoteDirectoryStats>()
  let count = 0
  const calls: unknown[] = []
  const view = await mount({
    getRemoteEntryProperties: async () => ({ ...file, type: 'directory' }),
    getRemoteDirectoryStats: async (...args) => {
      calls.push(args)
      return ++count === 1 ? first.promise : { allocatedBytes: 8192, directoryCount: 1, fileCount: 1234 }
    },
  })
  try {
    assert.equal(count, 0)
    assert.match(view.host.textContent!, /未计算/)
    assert.doesNotMatch(view.host.textContent!, /包含/)
    assert.ok(!view.host.textContent!.includes('1,234'))
    await view.click('计算占用空间')
    assert.equal(view.button('计算占用空间').disabled, true)
    await view.click('计算占用空间')
    assert.equal(count, 1)
    await act(async () => first.reject(new Error('远程命令执行超时')))
    assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /超时/)
    assert.doesNotMatch(view.host.textContent!, /包含/)
    assert.match(view.host.textContent!, /alice/)
    await view.click('重试计算')
    assert.match(view.host.textContent!, /8,192 字节/)
    assert.match(view.host.textContent!, /包含 1 个文件夹，1,234 个文件/)
    await act(async () => { setLanguage('en') })
    assert.match(view.host.textContent!, /Contains 1 folder and 1,234 files/)
    assert.deepEqual(calls, [['session-a', '/notes.txt'], ['session-a', '/notes.txt']])
  } finally { view.unmount(); setLanguage('zh-CN') }
})

test('late responses cannot replace properties for a different session or path, or update an unmounted dialog', async () => {
  const old = deferred<RemoteEntryProperties>()
  const oldStats = deferred<RemoteDirectoryStats>()
  const afterClose = deferred<RemoteDirectoryStats>()
  const calls: unknown[] = []
  const view = await mount({
    getRemoteEntryProperties: async (session, path) => {
      calls.push([session, path])
      return session === 'session-a' ? old.promise : { ...file, name: path, path, type: 'directory' }
    },
    getRemoteDirectoryStats: async (_session, path) => {
      if (path === '/long/new-directory') return oldStats.promise
      if (path === '/another-directory') return afterClose.promise
      return emptyStats
    },
  })
  await view.render('session-b', '/long/new-directory')
  await act(async () => old.resolve(file))
  assert.ok(!view.host.textContent!.includes('notes.txt'))
  assert.match(view.host.textContent!, /\/long\/new-directory/)
  assert.deepEqual(calls, [['session-a', '/notes.txt'], ['session-b', '/long/new-directory']])
  await view.click('计算占用空间')
  await view.render('session-b', '/empty-directory')
  await act(async () => oldStats.resolve({ allocatedBytes: 8192, directoryCount: 1, fileCount: 2 }))
  assert.match(view.host.textContent!, /未计算/)
  assert.doesNotMatch(view.host.textContent!, /包含/)
  await view.click('计算占用空间')
  assert.match(view.host.textContent!, /包含 0 个文件夹，0 个文件/)
  await view.render('session-b', '/another-directory')
  await view.click('计算占用空间')
  view.escape()
  assert.equal(view.closed, 1)
  view.unmount()
  await act(async () => afterClose.resolve(emptyStats))
  assert.equal(document.querySelector('[role="dialog"]'), null)
})

test('opens and retries detailed usage independently, cancels by request, and preserves simple statistics on return', async () => {
  const result: RemoteDirectoryUsageNode[] = [{ name: 'notes.txt', parentIndex: null, type: 'directory', allocatedBytes: 4096, sharedAllocation: false }]
  const cancelled = deferred<RemoteDirectoryUsageNode[]>()
  const failed = deferred<RemoteDirectoryUsageNode[]>()
  const closing = deferred<RemoteDirectoryUsageNode[]>()
  const requests: string[] = []
  const cancellations: string[] = []
  const view = await mount({
    getRemoteEntryProperties: async () => ({ ...file, type: 'directory' }),
    getRemoteDirectoryStats: async () => emptyStats,
    getRemoteDirectoryUsageTree: async (sessionId, path, requestId) => {
      assert.equal(sessionId, 'session-a')
      assert.equal(path, '/notes.txt')
      requests.push(requestId)
      return [cancelled.promise, failed.promise, result, closing.promise][requests.length - 1]
    },
    cancelRemoteDirectoryUsageTree: async (requestId) => { cancellations.push(requestId); return true },
  })
  const calculate = '计算详细空间（树展示）'
  try {
    await view.click('计算占用空间')
    assert.match(view.host.textContent!, /包含 0 个文件夹，0 个文件/)
    assert.equal(requests.length, 0)
    await view.click(calculate)
    assert.match(view.host.querySelector('[role="status"]')!.textContent!, /正在计算详细/)
    assert.equal(document.activeElement?.textContent, '取消')
    await view.click('取消')
    assert.equal(document.activeElement?.textContent, calculate)
    await act(async () => cancelled.resolve(result))
    assert.equal(view.host.querySelector('[role="tree"]'), null)
    assert.match(view.host.textContent!, /包含 0 个文件夹，0 个文件/)
    await view.click(calculate)
    await act(async () => failed.reject(new Error('Permission denied')))
    assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /Permission denied/)
    await view.click('重试计算')
    assert.ok(view.host.querySelector('[role="tree"]'))
    await view.click('返回属性')
    assert.match(view.host.textContent!, /包含 0 个文件夹，0 个文件/)
    await view.click(calculate)
    view.escape()
    assert.equal(view.closed, 1)
    assert.deepEqual(cancellations, [requests[0], requests[3]])
    assert.equal(new Set(requests).size, 4)
    await act(async () => closing.resolve(result))
    assert.equal(view.host.querySelector('[role="tree"]'), null)
  } finally { view.unmount() }
})

test('switching directory cancels the old detailed usage request and discards its result', async () => {
  const old = deferred<RemoteDirectoryUsageNode[]>()
  let requestId: string | undefined
  const cancellations: string[] = []
  const view = await mount({
    getRemoteEntryProperties: async (_sessionId, path) => ({ ...file, type: 'directory', path }),
    getRemoteDirectoryStats: async () => emptyStats,
    getRemoteDirectoryUsageTree: async (_sessionId, _path, id) => { requestId = id; return old.promise },
    cancelRemoteDirectoryUsageTree: async (id) => { cancellations.push(id); return true },
  })
  try {
    await view.click('计算详细空间（树展示）')
    await view.render('session-b', '/new-folder')
    await act(async () => old.resolve([{ name: 'old', parentIndex: null, type: 'directory', allocatedBytes: 0, sharedAllocation: false }]))
    assert.deepEqual(cancellations, [requestId])
    assert.match(view.host.textContent!, /\/new-folder/)
    assert.equal(view.host.querySelector('[role="tree"]'), null)
  } finally { view.unmount() }
})

test('Escape closes properties above search without dismissing the search dialog', async () => {
  const { createRoot } = await import('react-dom/client')
  Object.defineProperty(window, 'remoteFiles', { configurable: true, value: {
    getRemoteEntryProperties: async () => file,
    onNameSearchEvent: () => () => {}, onContentSearchEvent: () => () => {},
  } })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let searchClosed = 0
  function View() {
    const [open, setOpen] = useState(true)
    return createElement(Fragment, null,
      createElement(SearchDialog, {
        sessionId: 'session-a', profileId: 'profile', currentPath: '/', visible: true, previewOpen: open,
        fileTypeExtensions: defaultFileTypeExtensions(), onClose: () => { searchClosed++ }, onMenuAction: () => {},
      }),
      open && createElement(RemoteEntryPropertiesDialog, { sessionId: 'session-a', path: '/notes.txt', onClose: () => setOpen(false) }),
    )
  }
  try {
    await act(async () => root.render(createElement(View)))
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    assert.equal(host.querySelector('.file-properties-modal'), null)
    assert.ok(host.querySelector('.search-modal'))
    assert.equal(searchClosed, 0)
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    assert.equal(searchClosed, 1)
  } finally { act(() => root.unmount()); host.remove() }
})
