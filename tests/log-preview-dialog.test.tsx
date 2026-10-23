import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, createRef } from 'react'
import { JSDOM } from 'jsdom'

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
