import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ComponentProps } from 'react'
import { JSDOM } from 'jsdom'
import type { RemoteEntry, RemoteFilesApi } from '../src/shared/types.ts'
import { LocalizedError, msg, tr } from '../src/shared/i18n/messages.ts'
import { entryNameCollator } from '../src/renderer/src/app-utils.ts'
import FilePathBar from '../src/renderer/src/features/files/FilePathBar.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

function entry(name: string, type: RemoteEntry['type'] = 'directory', targetType?: RemoteEntry['targetType']): RemoteEntry {
  return { name, path: `/fixture/${name}`, type, targetType, size: 0, permissions: '755', modifiedAt: null }
}

async function mount() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const requests: Array<{ sessionId: string; path: string; resolve: (entries: RemoteEntry[]) => void; reject: (error: unknown) => void }> = []
  const navigations: string[] = []
  window.remoteFiles = {
    listDirectory: (sessionId, path) => new Promise<RemoteEntry[]>((resolve, reject) => requests.push({ sessionId, path, resolve, reject })),
  } as Pick<RemoteFilesApi, 'listDirectory'> as RemoteFilesApi
  let props: ComponentProps<typeof FilePathBar> = {
    sessionId: 'first', fileIdentity: 'login', currentPath: '/srv', breadcrumbs: [], viewMode: 'details', entryCount: 4,
    onViewModeChange: () => {}, onNavigate: async () => true,
    onSubmitPath: async (path) => { navigations.push(path); return true },
  }
  const render = (patch: Partial<typeof props> = {}) => {
    props = { ...props, ...patch }
    act(() => root.render(createElement(FilePathBar, props)))
  }
  const click = (target: Element) => act(() => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
  const input = () => host.querySelector<HTMLInputElement>('input')!
  const edit = () => click(host.querySelector(`[aria-label="${tr('files.editPath')}"]`)!)
  const change = (value: string, caret = value.length) => {
    act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input(), value)
      input().setSelectionRange(caret, caret)
      input().dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText' }))
    })
  }
  const press = (key: string, options: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
    act(() => { input().dispatchEvent(event) })
    return event
  }
  const moveCaret = (position: number) => act(() => {
    input().setSelectionRange(position, position)
    input().dispatchEvent(new dom.window.KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }))
  })
  const submit = async () => {
    await act(async () => { host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
  }
  const resolve = async (index: number, entries: RemoteEntry[]) => {
    await act(async () => { requests[index].resolve(entries) })
  }
  const reject = async (index: number, error: unknown) => {
    await act(async () => { requests[index].reject(error) })
  }
  const options = () => [...host.querySelectorAll('[role="option"]')].map(option => option.textContent)
  render()
  return { host, input, edit, change, press, moveCaret, click, submit, render, resolve, reject, requests, navigations, options,
    cleanup: () => { act(() => root.unmount()); host.remove() } }
}

test('slash queries directories once and prefix typing filters locally with case sensitivity', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  assert.equal(ui.requests.length, 0)
  assert.equal(document.activeElement, ui.input())
  assert.equal(ui.input().selectionStart, 0)
  assert.equal(ui.input().selectionEnd, 4)
  ui.change('/')
  assert.equal(ui.requests.length, 1)
  assert.equal(ui.requests[0].path, '/')
  assert.equal(ui.input().getAttribute('aria-expanded'), 'true')
  assert.match(ui.host.textContent!, /正在读取目录/)
  await ui.resolve(0, [entry('local'), entry('Log'), entry('.hidden'), entry('dir10'), entry('dir2'),
    entry('alias', 'symlink', 'directory'), entry('notes.txt', 'file'), entry('broken', 'symlink'), entry('file-link', 'symlink', 'file')])
  assert.deepEqual(ui.options(), ['local', 'Log', '.hidden', 'dir10', 'dir2', 'alias'].sort(entryNameCollator.compare).map(name => name + '/'))
  ui.change('/lo')
  assert.deepEqual(ui.options(), ['local/'])
  ui.change('/Lo')
  assert.deepEqual(ui.options(), ['Log/'])
  ui.change('/missing')
  assert.deepEqual(ui.options(), [])
  assert.match(ui.host.textContent!, /没有匹配的目录/)
  ui.change('/.h')
  assert.deepEqual(ui.options(), ['.hidden/'])
  assert.equal(ui.requests.length, 1)
  assert.deepEqual(ui.navigations, [])
})

test('mouse and Tab complete paths and query the next level without navigating', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/usr/')
  await ui.resolve(0, [entry('local')])
  ui.click(ui.host.querySelector('[role="option"]')!)
  assert.equal(ui.input().value, '/usr/local/')
  assert.equal(ui.input().selectionStart, '/usr/local/'.length)
  assert.equal(document.activeElement, ui.input())
  assert.equal(ui.requests[1].path, '/usr/local/')
  await ui.resolve(1, [entry('share')])
  assert.equal(ui.press('Tab').defaultPrevented, true)
  assert.equal(ui.input().value, '/usr/local/share/')
  assert.equal(ui.requests[2].path, '/usr/local/share/')
  assert.deepEqual(ui.navigations, [])
  await ui.resolve(2, [])
  assert.equal(ui.press('Enter').defaultPrevented, false)
  await ui.submit()
  assert.deepEqual(ui.navigations, ['/usr/local/share/'])
  assert.equal(ui.input(), null)
})

test('arrows select candidates, Enter accepts selection and Escape closes before cancelling', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/srv/')
  await ui.resolve(0, [entry('beta'), entry('alpha')])
  assert.equal(ui.host.querySelector('[aria-selected="true"]'), null)
  ui.press('ArrowDown')
  assert.equal(ui.host.querySelector('[aria-selected="true"]')!.textContent, 'alpha/')
  const selected = ui.host.querySelector('[aria-selected="true"]')!
  assert.equal(ui.input().getAttribute('aria-activedescendant'), selected.id)
  ui.press('ArrowUp')
  assert.equal(ui.host.querySelector('[aria-selected="true"]')!.textContent, 'beta/')
  ui.press('ArrowDown')
  assert.equal(ui.press('Enter').defaultPrevented, true)
  assert.equal(ui.input().value, '/srv/alpha/')
  assert.equal(ui.requests[1].path, '/srv/alpha/')
  ui.press('Escape')
  assert.equal(ui.input().getAttribute('aria-expanded'), 'false')
  await ui.resolve(1, [entry('late')])
  assert.deepEqual(ui.options(), [])
  assert.equal(ui.input().value, '/srv/alpha/')
  ui.press('Escape')
  assert.equal(ui.input(), null)
  assert.deepEqual(ui.navigations, [])
})

test('paste, repeated slashes and out-of-order responses use only the latest directory', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/usr/')
  ui.change('/usr//')
  ui.change('/var/log/')
  assert.deepEqual(ui.requests.map(request => request.path), ['/usr/', '/usr//', '/var/log/'])
  ui.change('/var/log/ap')
  await ui.resolve(2, [entry('app'), entry('system')])
  await ui.resolve(0, [entry('old')])
  await ui.reject(1, new Error('old failure'))
  assert.deepEqual(ui.options(), ['app/'])
  assert.equal(ui.requests.length, 3)
  ui.change('/other')
  assert.equal(ui.input().getAttribute('aria-expanded'), 'false')
  assert.deepEqual(ui.options(), [])
})

test('empty directories and read errors remain visible and do not block manual navigation', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/empty/')
  await ui.resolve(0, [])
  assert.match(ui.host.textContent!, /没有匹配的目录/)
  ui.change('/private/')
  await ui.reject(1, new Error('Permission denied'))
  assert.match(ui.host.textContent!, /无法读取目录提示：Permission denied/)
  assert.equal(ui.press('Tab').defaultPrevented, false)
  assert.equal(ui.press('Enter').defaultPrevented, false)
  await ui.submit()
  assert.deepEqual(ui.navigations, ['/private/'])
  ui.edit()
  ui.change('/missing/')
  await ui.reject(2, new LocalizedError(msg('errors.invalidRemotePath')))
  assert.match(ui.host.textContent!, /无法读取目录提示/)
  ui.render({ onSubmitPath: async () => false })
  await ui.submit()
  assert.equal(ui.input().value, '/missing/')
  assert.equal(ui.input().disabled, false)
  assert.equal(ui.input().getAttribute('aria-expanded'), 'false')
})

test('outside dismissal, navigation, session and identity changes invalidate pending suggestions', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/outside/')
  act(() => document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true })))
  assert.equal(ui.input(), null)
  ui.edit()
  await ui.resolve(0, [entry('late')])
  assert.deepEqual(ui.options(), [])
  for (const patch of [{ sessionId: 'second' }, { fileIdentity: 'sudo-root' as const }, { currentPath: '/tmp' }]) {
    ui.change('/pending/')
    const index = ui.requests.length - 1
    ui.render(patch)
    assert.equal(ui.input(), null)
    ui.edit()
    await ui.resolve(index, [entry('stale')])
    assert.deepEqual(ui.options(), [])
    assert.equal(ui.input().getAttribute('aria-expanded'), 'false')
  }
  ui.change('/fresh/')
  assert.equal(ui.requests.at(-1)!.sessionId, 'second')
})

test('editing in the middle completes the current segment and preserves the remaining path', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  ui.edit()
  ui.change('/usr//logs', 5)
  assert.equal(ui.requests[0].path, '/usr/')
  await ui.resolve(0, [entry('local')])
  ui.press('Tab')
  assert.equal(ui.input().value, '/usr/local/logs')
  assert.equal(ui.input().selectionStart, 11)
  assert.equal(ui.requests[1].path, '/usr/local/')
  ui.moveCaret(0)
  assert.equal(ui.input().getAttribute('aria-expanded'), 'false')
  await ui.resolve(1, [entry('late')])
  assert.deepEqual(ui.options(), [])
})

test('an old navigation result cannot close a newly opened editor', async (t) => {
  const ui = await mount()
  t.after(ui.cleanup)
  let finish!: (success: boolean) => void
  ui.render({ onSubmitPath: () => new Promise<boolean>(resolve => { finish = resolve }) })
  ui.edit()
  ui.change('/next')
  await ui.submit()
  assert.equal(ui.input().disabled, true)
  act(() => document.body.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true })))
  ui.edit()
  await act(async () => { finish(true) })
  assert.equal(ui.input().value, '/srv')
})
