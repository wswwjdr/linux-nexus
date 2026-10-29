import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useState } from 'react'
import { JSDOM } from 'jsdom'
import TextPreviewPanel from '../src/renderer/src/components/previews/TextPreviewPanel.tsx'
import { findTextMatches } from '../src/renderer/src/components/previews/text-search.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})

function key(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
  const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  act(() => { target.dispatchEvent(event) })
  return event
}

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

async function mount(content: string) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  let saves = 0
  function Harness({ saving = false, confirming = false }) {
    const [draft, setDraft] = useState(content)
    return createElement(TextPreviewPanel, {
      draft, dirty: draft !== content, saving, saveConfirmationOpen: confirming,
      onUpdateDraft: setDraft, onRequestSave: () => { saves++ },
    })
  }
  act(() => root.render(createElement(Harness)))
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!
  return {
    host, editor,
    get search() { return host.querySelector<HTMLInputElement>('[aria-label="搜索文本"]')! },
    get count() { return host.querySelector('[role="status"]')?.textContent },
    get saves() { return saves },
    button(label: string) { return host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)! },
    block(saving: boolean, confirming: boolean) { act(() => root.render(createElement(Harness, { saving, confirming }))) },
    unmount() { act(() => root.unmount()); host.remove() },
  }
}

test('literal search preserves offsets for Unicode, whitespace, special characters and repeated matches', () => {
  assert.deepEqual(findTextMatches('a.b A.B a?b', 'a.b', false), [0, 4])
  assert.deepEqual(findTextMatches('a.b A.B', 'a.b', true), [0])
  assert.deepEqual(findTextMatches('İ x TARGET target', 'target', false), [4, 11])
  assert.deepEqual(findTextMatches('中文🙂 中文🙂', '中文🙂', false), [0, 5])
  assert.deepEqual(findTextMatches('aaaaa', 'aa', true), [0, 2])
  assert.deepEqual(findTextMatches('a  b', ' ', true), [1, 2])
  assert.deepEqual(findTextMatches('[a] \\ $ ^', '[a]', false), [0])
  assert.deepEqual(findTextMatches('anything', '', false), [])
})

test('search opens, counts, navigates in both directions, wraps, and closes before the preview', async () => {
  const view = await mount('alpha Beta ALPHA alpha')
  let escaped = 0
  const listener = (event: Event) => { if ((event as KeyboardEvent).key === 'Escape') escaped++ }
  window.addEventListener('keydown', listener)
  try {
    assert.equal(key(view.editor, 'f', { ctrlKey: true }).defaultPrevented, true)
    assert.equal(document.activeElement, view.search)
    input(view.search, 'alpha')
    assert.equal(view.count, '1 / 3')
    assert.equal(view.editor.selectionStart, 0)
    key(view.search, 'Enter')
    assert.equal(view.count, '2 / 3')
    assert.equal(view.editor.selectionStart, 11)
    assert.equal(view.host.querySelector('mark')?.textContent, 'ALPHA')
    assert.equal(document.activeElement, view.search)
    key(view.search, 'Enter', { shiftKey: true })
    assert.equal(view.count, '1 / 3')
    key(view.search, 'F3', { shiftKey: true })
    assert.equal(view.count, '3 / 3')
    act(() => view.button('下一处').click())
    assert.equal(view.count, '1 / 3')
    act(() => view.button('区分大小写').click())
    assert.equal(view.count, '1 / 2')
    assert.equal(view.button('区分大小写').getAttribute('aria-pressed'), 'true')
    input(view.search, 'missing')
    assert.equal(view.count, '无匹配')
    assert.equal(view.button('下一处').disabled, true)
    assert.equal(view.host.querySelector('mark'), null)
    key(view.search, 'Escape')
    assert.equal(view.search, null)
    assert.equal(document.activeElement, view.editor)
    assert.equal(escaped, 0)
    key(view.editor, 'Escape')
    assert.equal(escaped, 1)
    assert.equal(view.editor.value, 'alpha Beta ALPHA alpha')
  } finally {
    window.removeEventListener('keydown', listener)
    view.unmount()
  }
})

test('search uses selected text and normalized CRLF offsets without disrupting ongoing edits', async () => {
  const view = await mount('前言\r\n目标 TARGET target')
  try {
    view.editor.setSelectionRange(6, 12)
    key(view.editor, 'f', { metaKey: true })
    assert.equal(view.search.value, 'TARGET')
    assert.equal(view.count, '1 / 2')
    assert.equal(view.editor.selectionStart, 6)
    input(view.editor, '前言\n目标 TARGET target target')
    assert.equal(view.count, '1 / 3')
    // Native input places the caret at the end; search must not select a match while typing.
    assert.equal(view.editor.selectionStart, view.editor.value.length)
    assert.equal(view.host.querySelector('.text-preview-status')?.textContent, '有未保存修改')
    key(view.editor, 's', { ctrlKey: true })
    assert.equal(view.saves, 1)
    key(view.search, 'Enter', { isComposing: true })
    assert.equal(view.count, '1 / 3')
  } finally { view.unmount() }
})

test('save confirmation and saving disable search controls and save shortcuts', async () => {
  const view = await mount('text')
  try {
    act(() => view.button('搜索文本（Ctrl+F）').click())
    input(view.search, 'text')
    for (const [saving, confirming] of [[false, true], [true, false]]) {
      view.block(saving, confirming)
      assert.equal(view.search.disabled, true)
      assert.equal(view.editor.disabled, true)
      assert.equal(view.button('下一处').disabled, true)
      key(view.editor, 's', { ctrlKey: true })
      assert.equal(view.saves, 0)
    }
  } finally { view.unmount() }
})
