import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type {
  ContentSearchEvent,
  ContentSearchRequest,
  NameSearchEvent,
  NameSearchRequest,
  RemoteFilesApi,
} from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
  ResizeObserver: {
    configurable: true,
    value: class {
      observe() {}
      disconnect() {}
    },
  },
})

// JSDOM has no layout; provide a visible viewport for the measured virtual list.
Object.defineProperties(dom.window.HTMLElement.prototype, {
  offsetHeight: { configurable: true, get() { return this.classList.contains('content-search-results-list') ? 600 : 120 } },
  offsetWidth: { configurable: true, get() { return 800 } },
  clientHeight: { configurable: true, get() { return 600 } },
  clientWidth: { configurable: true, get() { return 800 } },
})

test('clicking a filename result opens its menu while the click target is still available', async () => {
  const [{ createRoot }, { NameSearchPane }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/features/search/NameSearchPane.tsx'),
  ])
  let listener: ((event: NameSearchEvent) => void) | null = null
  let request: NameSearchRequest | null = null
  const remoteFiles = {
    onNameSearchEvent: (nextListener: (event: NameSearchEvent) => void) => {
      listener = nextListener
      return () => { listener = null }
    },
    startNameSearch: async (nextRequest: NameSearchRequest) => { request = nextRequest },
    cancelNameSearch: async () => true,
  } as unknown as RemoteFilesApi
  window.remoteFiles = remoteFiles

  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  try {
    act(() => root.render(createElement(NameSearchPane, {
      sessionId: 'session',
      profileId: 'profile',
      currentPath: '/',
      active: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      onRunningChange: () => {},
      onMenuOpenChange: () => {},
      onMenuAction: () => {},
    })))

    const query = host.querySelector<HTMLInputElement>('.search-query-field input')!
    const setInputValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setInputValue.call(query, 'run.sh')
      query.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const searchButton = host.querySelector<HTMLButtonElement>('.search-form-actions button[type="submit"]')!
    assert.equal(searchButton.disabled, false)

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })
    assert.ok(request)
    assert.ok(listener)

    act(() => {
      listener!({
        type: 'results',
        requestId: request!.requestId,
        sessionId: 'session',
        profileId: 'profile',
        elapsedMs: 1,
        matchedFiles: 1,
        incomplete: false,
        hasReadErrors: false,
        results: [{ name: 'run.sh', path: '/home/user/run.sh', type: 'file' }],
      })
      listener!({
        type: 'finished',
        status: 'completed',
        requestId: request!.requestId,
        sessionId: 'session',
        profileId: 'profile',
        elapsedMs: 1,
        matchedFiles: 1,
        incomplete: false,
        hasReadErrors: false,
      })
    })

    act(() => host.querySelector<HTMLButtonElement>('.name-search-result')!.click())
    assert.ok(host.querySelector('[role="menu"][aria-label="run.sh的操作"]'))
    assert.ok(Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .some((item) => item.textContent?.includes('打开所在目录')))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

test('clicking a content result opens its menu while the click target is still available', async () => {
  const [{ createRoot }, { ContentSearchPane }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/features/search/ContentSearchPane.tsx'),
  ])
  let listener: ((event: ContentSearchEvent) => void) | null = null
  let request: ContentSearchRequest | null = null
  window.remoteFiles = {
    onContentSearchEvent: (nextListener: (event: ContentSearchEvent) => void) => {
      listener = nextListener
      return () => { listener = null }
    },
    startContentSearch: async (nextRequest: ContentSearchRequest) => { request = nextRequest },
    cancelContentSearch: async () => true,
  } as unknown as RemoteFilesApi

  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  try {
    act(() => root.render(createElement(ContentSearchPane, {
      sessionId: 'session',
      profileId: 'profile',
      currentPath: '/',
      active: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      onRunningChange: () => {},
      onMenuOpenChange: () => {},
      onMenuAction: () => {},
    })))

    const query = host.querySelector<HTMLInputElement>('.search-query-field input')!
    const setInputValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setInputValue.call(query, 'needle')
      query.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    const searchButton = host.querySelector<HTMLButtonElement>('.search-form-actions button[type="submit"]')!
    assert.equal(searchButton.disabled, false)

    await act(async () => {
      searchButton.click()
      await Promise.resolve()
    })
    assert.ok(request)
    assert.ok(listener)

    act(() => {
      listener!({
        type: 'results',
        requestId: request!.requestId,
        sessionId: 'session',
        profileId: 'profile',
        elapsedMs: 1,
        processedFiles: 1,
        processedBytes: 16,
        matchedFiles: 1,
        matchedLines: 1,
        skippedLargeFiles: 0,
        skippedBinaryFiles: 0,
        readErrors: 0,
        currentPath: null,
        incomplete: false,
        results: [{
          name: 'notes.txt',
          path: '/home/user/notes.txt',
          type: 'file',
          size: 16,
          matches: [{ lineNumber: 1, text: '<b>NEEDLE</b> needle a.b' }],
        }],
      })
      listener!({
        type: 'finished',
        status: 'completed',
        requestId: request!.requestId,
        sessionId: 'session',
        profileId: 'profile',
        elapsedMs: 1,
        processedFiles: 1,
        processedBytes: 16,
        matchedFiles: 1,
        matchedLines: 1,
        skippedLargeFiles: 0,
        skippedBinaryFiles: 0,
        readErrors: 0,
        currentPath: null,
        incomplete: false,
      })
    })

    const code = host.querySelector('.search-match-line.hit code')!
    assert.equal(code.textContent, '<b>NEEDLE</b> needle a.b')
    assert.deepEqual(Array.from(code.querySelectorAll('mark'), node => node.textContent), ['NEEDLE', 'needle'])
    assert.equal(code.querySelector('b'), null)
    act(() => host.querySelector<HTMLButtonElement>('.content-search-result')!.click())
    assert.ok(host.querySelector('[role="menu"][aria-label="notes.txt的操作"]'))
    assert.ok(Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .some((item) => item.textContent?.includes('打开所在目录')))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
