import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import type { SessionTab } from '../src/renderer/src/app-types.ts'
import { useRemoteFileShortcuts } from '../src/renderer/src/features/files/useRemoteFileShortcuts.ts'

test('F5 refreshes only the active file browser and respects loading and shortcut scope', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>')
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const session: SessionTab = {
    id: 'files', profileId: 'server', kind: 'files', status: 'connected',
    currentPath: '/home', startPath: '/', entries: [], selectedPaths: [], loading: false,
    viewMode: 'details', sort: { column: 'name', direction: 'ascending' },
    highlightedPath: null, history: ['/home'], historyIndex: 0, error: null,
  }
  const refreshed: string[] = []
  const defaults: Parameters<typeof useRemoteFileShortcuts>[0] = {
    activeSession: session, activeSessionId: session.id, modalOpen: false,
    workspaceOpenSessionIds: new Set(), browserContextMenu: null, sessionContextMenu: null,
    sortedEntries: [], canPasteRemote: false,
    onRefresh: () => { refreshed.push(session.id) },
    onSelectedPathsChange: () => {}, copyRemoteSelection: () => {},
    cutRemoteSelection: () => {}, pasteRemoteEntries: () => {},
  }
  function Harness(options: typeof defaults) {
    useRemoteFileShortcuts(options)
    return createElement('input')
  }
  const render = (overrides: Partial<typeof defaults> = {}) => {
    act(() => root.render(createElement(Harness, { ...defaults, ...overrides })))
  }
  const press = (options: KeyboardEventInit = {}, target: EventTarget = window) => {
    const event = new dom.window.KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true, ...options })
    act(() => { target.dispatchEvent(event) })
    return event
  }
  try {
    render()
    assert.equal(press().defaultPrevented, true)
    assert.deepEqual(refreshed, ['files'])
    assert.equal(press({}, host.querySelector('input')!).defaultPrevented, true)
    assert.equal(refreshed.length, 2)

    for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }]) {
      assert.equal(press(options).defaultPrevented, false)
    }
    assert.equal(press({ repeat: true }).defaultPrevented, true)
    assert.equal(refreshed.length, 2)

    render({ activeSession: { ...session, loading: true } })
    assert.equal(press().defaultPrevented, true)
    assert.equal(refreshed.length, 2)

    for (const overrides of [
      { activeSession: null },
      { activeSession: { ...session, kind: 'terminal' as const } },
      { activeSession: { ...session, status: 'disconnected' as const } },
      { modalOpen: true },
      { workspaceOpenSessionIds: new Set([session.id]) },
    ]) {
      render(overrides)
      press()
      assert.equal(refreshed.length, 2)
    }

    render({
      activeSession: { ...session, id: 'other', currentPath: '/tmp' }, activeSessionId: 'other',
      onRefresh: () => { refreshed.push('other') },
    })
    press()
    assert.deepEqual(refreshed, ['files', 'files', 'other'])

    act(() => root.unmount())
    press()
    assert.equal(refreshed.length, 3)
  } finally {
    dom.window.close()
  }
})
