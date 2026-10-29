import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import type { RemoteEntry } from '../src/shared/types.ts'
import RemoteEntryRenameDialog from '../src/renderer/src/components/RemoteEntryRenameDialog.tsx'

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

async function mount(name: string, type: RemoteEntry['type'], onSubmit: (name: string) => Promise<void> = async () => {}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let closed = 0
  await act(async () => root.render(createElement(RemoteEntryRenameDialog, {
    state: {
      entry: { name, type, path: '/home/' + name, size: 0, modifiedAt: null, permissions: '' },
      sessionId: 'session', profileId: 'profile',
    },
    onSubmit, onClose: () => { closed += 1 },
  })))
  const input = host.querySelector('input')!
  return {
    host, input,
    get closed() { return closed },
    async change(value: string) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    },
    async submit() {
      await act(async () => { host.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) })
    },
    escape() {
      act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    },
    unmount() { act(() => root.unmount()); host.remove() },
  }
}

test('focuses the name, preserves file extensions in the initial selection, and selects full folder and dotfile names', async () => {
  for (const [name, type, end] of [
    ['notes.txt', 'file', 5], ['folder.name', 'directory', 11], ['.env', 'file', 4],
  ] as const) {
    const view = await mount(name, type)
    try {
      assert.equal(document.activeElement, view.input)
      assert.equal(view.input.selectionStart, 0)
      assert.equal(view.input.selectionEnd, end)
      assert.match(view.host.querySelector('h2')!.textContent!, type === 'directory' ? /重命名文件夹/ : /重命名文件/)
      view.escape()
      assert.equal(view.closed, 1)
    } finally { view.unmount() }
  }
})

test('invalid names stay in the dialog and server errors can be corrected and retried without trimming the name', async () => {
  const names: string[] = []
  const view = await mount('old.txt', 'file', async (name) => {
    names.push(name)
    if (name === 'exists.txt') throw new Error('同名文件或文件夹已存在')
  })
  try {
    for (const name of ['', '.', '..', 'nested/name']) {
      await view.change(name)
      await view.submit()
      assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /名称不能为空/)
    }
    assert.deepEqual(names, [])
    await view.change('exists.txt')
    await view.submit()
    assert.match(view.host.querySelector('[role="alert"]')!.textContent!, /同名文件或文件夹已存在/)
    assert.equal(view.input.value, 'exists.txt')
    assert.equal(view.input.disabled, false)
    await view.change(' 新文件.txt ')
    await view.submit()
    assert.deepEqual(names, ['exists.txt', ' 新文件.txt '])
    assert.equal(view.host.querySelector('[role="alert"]'), null)
  } finally { view.unmount() }
})

test('pending rename blocks duplicate submissions and dismissal until the request settles', async () => {
  let finish!: () => void
  let count = 0
  const view = await mount('old.txt', 'file', () => {
    count += 1
    return new Promise<void>((resolve) => { finish = resolve })
  })
  try {
    await view.change('new.txt')
    await view.submit()
    await view.submit()
    view.escape()
    assert.equal(count, 1)
    assert.equal(view.input.disabled, true)
    assert.equal(view.closed, 0)
    for (const button of view.host.querySelectorAll('button')) assert.equal(button.disabled, true)
    await act(async () => { finish() })
    assert.equal(view.input.disabled, false)
    view.escape()
    assert.equal(view.closed, 1)
  } finally { view.unmount() }
})
