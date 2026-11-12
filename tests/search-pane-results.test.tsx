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
import { buildContentSearchCommand, buildNameSearchCommand } from '../src/shared/search-commands.ts'

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

for (const kind of ['name', 'content'] as const) {
  test(`${kind} command preview updates before searching, validates conditions and replays history`, async () => {
    const [{ createRoot }, { NameSearchPane }, { ContentSearchPane }] = await Promise.all([
      import('react-dom/client'),
      import('../src/renderer/src/features/search/NameSearchPane.tsx'),
      import('../src/renderer/src/features/search/ContentSearchPane.tsx'),
    ])
    let startCalls = 0
    window.remoteFiles = {
      onNameSearchEvent: () => () => {},
      onContentSearchEvent: () => () => {},
      startNameSearch: async () => { startCalls += 1 },
      startContentSearch: async () => { startCalls += 1 },
    } as unknown as RemoteFilesApi
    const saved = { query: "saved ' [x]", rootPath: '/srv/saved', scope: 'custom', ignoreCase: false, matchMode: 'contains', maxFileSizeMiB: 8 }
    const historyKey = `remote-files:${kind === 'name' ? 'name' : 'content'}-search-history:v2:preview-${kind}`
    window.localStorage.setItem(historyKey, JSON.stringify([saved]))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const input = (selector: string, value: string) => {
      const element = host.querySelector<HTMLInputElement>(selector)!
      const setValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!
      act(() => {
        setValue.call(element, value)
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      })
    }
    const preview = () => host.querySelector('.search-native-command pre')?.textContent
    try {
      act(() => root.render(createElement(kind === 'name' ? NameSearchPane : ContentSearchPane, {
        sessionId: 'session', profileId: `preview-${kind}`, currentPath: '/home/user', active: true,
        fileTypeExtensions: defaultFileTypeExtensions(),
        onRunningChange: () => {}, onMenuOpenChange: () => {}, onMenuAction: () => {},
      })))
      assert.ok(host.querySelector('section.search-native-command'))
      assert.equal(host.querySelector('.search-native-command summary'), null)
      assert.equal(preview(), undefined)
      input('.search-query-field input', "a'b*[x]")
      if (kind === 'name') {
        assert.equal(preview(), buildNameSearchCommand({ rootPath: '/home/user', query: "a'b*[x]", matchMode: 'exact', ignoreCase: true }))
        act(() => host.querySelectorAll<HTMLButtonElement>('fieldset.search-option-field button')[1].click())
        assert.ok(preview()!.includes("'*a"))
      } else {
        assert.equal(preview(), buildContentSearchCommand({ rootPath: '/home/user', query: "a'b*[x]", ignoreCase: true, maxFileSizeMiB: 100 }))
        input('.search-size-field input', '')
        assert.equal(preview(), undefined)
        input('.search-size-field input', '2')
        assert.ok(preview()!.endsWith("'2097152'"))
      }
      act(() => host.querySelector<HTMLInputElement>('.search-case-option input')!.click())
      assert.ok(kind === 'name' ? preview()!.includes(' -name ') : preview()!.includes(" '0' "))
      act(() => host.querySelectorAll<HTMLButtonElement>('.search-scope-options button')[2].click())
      input('.search-custom-path-field input', 'relative/path')
      assert.equal(preview(), undefined)
      input('.search-custom-path-field input', "/srv/it's files")
      assert.ok(preview()!.includes("'/srv/it'\\''s files'"))
      input('.search-query-field input', '')
      assert.equal(preview(), undefined)
      act(() => host.querySelector<HTMLButtonElement>('.search-history-item')!.click())
      assert.equal(preview(), kind === 'name' ? buildNameSearchCommand(saved) : buildContentSearchCommand(saved))
      assert.equal(startCalls, 0)
    } finally {
      act(() => root.unmount())
      host.remove()
      window.localStorage.removeItem(historyKey)
    }
  })
}
