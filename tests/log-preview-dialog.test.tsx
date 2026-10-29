import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, createRef } from 'react'
import { JSDOM } from 'jsdom'
import type { LogPreviewDialog as LogPreviewDialogState } from '../src/renderer/src/app-types.ts'
import type { PreviewSearchHandle } from '../src/renderer/src/components/previews/usePreviewSearch.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
})

test('reverse preview searches loaded pages, retains its match on prepend, and supports keyboard navigation', async () => {
  const [{ createRoot }, { default: LogPreviewDialog }] = await Promise.all([
    import('react-dom/client'), import('../src/renderer/src/components/previews/LogPreviewDialog.tsx'),
  ])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const viewportRef = createRef<HTMLPreElement>()
  const searchHandle = createRef<PreviewSearchHandle>()
  const initial = 'target first\nTARGET last'
  let content = initial
  let closed = 0
  const render = (hasEarlier = true) => act(() => root.render(createElement(LogPreviewDialog, {
    logPreviewDialog: { kind: 'ready', name: 'app.log', sessionId: 's', path: '/app.log', content,
      startOffset: hasEarlier ? 100 : 0, fileSize: 1000, limitBytes: 1000, hasEarlier, loadingEarlier: false } as LogPreviewDialogState,
    logViewportRef: viewportRef, textSearchRef: searchHandle,
    onClosePreview: () => { closed++ }, onLogPreviewScroll: () => {},
  })))
  const key = (target: EventTarget, key: string, options: KeyboardEventInit = {}) => act(() => {
    target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }))
  })
  const count = () => host.querySelector('.text-preview-search-count')?.textContent
  try {
    render()
    key(viewportRef.current!, 'f', { ctrlKey: true })
    const input = host.querySelector<HTMLInputElement>('[aria-label="搜索文本"]')!
    assert.equal(document.activeElement, input)
    act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'target')
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    assert.equal(count(), '2 / 2')
    assert.equal(host.querySelector('mark')?.textContent, 'TARGET')
    assert.match(host.textContent!, /搜索范围：已加载内容/)
    key(input, 'Enter', { shiftKey: true })
    assert.equal(count(), '1 / 2')
    viewportRef.current!.scrollTop = 321
    content = 'earlier target\n' + initial
    render(false)
    assert.equal(count(), '2 / 3')
    assert.equal(viewportRef.current!.scrollTop, 321)
    assert.equal(host.querySelector('mark')?.textContent, 'target')
    assert.equal(host.querySelector('mark')!.previousSibling!.textContent, 'earlier target\n')
    key(input, 'F3')
    assert.equal(count(), '3 / 3')
    key(input, 'Enter')
    assert.equal(count(), '1 / 3')
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="区分大小写"]')!.click())
    assert.equal(count(), '2 / 2')
    key(input, 'Escape')
    assert.equal(host.querySelector('[role="search"]'), null)
    assert.equal(document.activeElement, viewportRef.current)
    assert.equal(closed, 0)
    assert.equal(viewportRef.current!.textContent, content)
    // Selection in the log becomes the next search term.
    const range = document.createRange()
    range.setStart(viewportRef.current!.firstChild!, 0)
    range.setEnd(viewportRef.current!.firstChild!, 7)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    act(() => searchHandle.current!.openSearch())
    assert.equal(host.querySelector<HTMLInputElement>('[aria-label="搜索文本"]')!.value, 'earlier')
    assert.equal(count(), '1 / 1')
  } finally {
    window.getSelection()!.removeAllRanges()
    act(() => root.unmount())
    host.remove()
  }
})

test('log preview uses the foreground preview layer when opened from search', async () => {
  const [{ createRoot }, { default: LogPreviewDialog }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/components/previews/LogPreviewDialog.tsx'),
  ])
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  try {
    act(() => root.render(createElement(LogPreviewDialog, {
      logPreviewDialog: { kind: 'loading', name: 'app.log' },
      logViewportRef: createRef<HTMLPreElement>(),
      onClosePreview: () => {},
      onLogPreviewScroll: () => {},
    })))

    const backdrop = host.querySelector('.log-preview-backdrop')
    assert.ok(backdrop?.classList.contains('preview-backdrop'))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
