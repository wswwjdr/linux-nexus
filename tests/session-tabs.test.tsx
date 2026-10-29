import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useRef, useState } from 'react'
import { JSDOM } from 'jsdom'
import type { RemoteFilesApi, ServerProfile } from '../src/shared/types.ts'
import type { SessionTab } from '../src/renderer/src/app-types.ts'
import SessionTabBar from '../src/renderer/src/features/sessions/SessionTabBar.tsx'
import { useSessionOperations } from '../src/renderer/src/features/sessions/useSessionOperations.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})
dom.window.HTMLElement.prototype.scrollIntoView = () => {}

const profile: ServerProfile = { id: 'server', name: 'Server', host: 'host', port: 22, username: 'user', pinned: false }
function session(id: string, kind: SessionTab['kind'] = 'files'): SessionTab {
  return {
    id, kind, profileId: profile.id, status: 'connected', currentPath: '/home/' + id,
    startPath: '/', entries: [], selectedPaths: [], loading: false, viewMode: 'details',
    sort: { column: 'name', direction: 'ascending' }, highlightedPath: null,
    history: ['/home/' + id], historyIndex: 0, error: null,
  }
}

async function mountTabs(initial = [session('first'), session('second', 'terminal'), session('third')]) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const disconnected: string[] = []
  const connections: unknown[][] = []
  window.remoteFiles = {
    disconnect: async (id: string) => { disconnected.push(id) },
    connect: async (...args: unknown[]) => { connections.push(args); throw new Error('Unexpected reconnection') },
  } as unknown as RemoteFilesApi
  let operations!: ReturnType<typeof useSessionOperations>
  let current!: { sessions: SessionTab[]; activeId: string | null; ref: SessionTab[] }
  const noOp = () => {}
  function Harness() {
    const [sessions, setSessions] = useState(initial)
    const [activeId, setActiveId] = useState<string | null>(initial[0]?.id ?? null)
    const sessionsRef = useRef(sessions)
    sessionsRef.current = sessions
    operations = useSessionOperations({
      sessions, sessionsRef, profiles: [profile], activeSessionId: activeId,
      activeSession: sessions.find(({ id }) => id === activeId) ?? null,
      viewModeDefault: 'details', pendingHostKey: null, startupConnection: null, profileDataLoaded: false,
      setSessions, setActiveSessionId: setActiveId, setPendingHostKeys: noOp, setRecentConnections: noOp,
      setBrowserContextMenu: noOp, setSessionContextMenu: noOp, setSessionChooserOpen: noOp,
      setCreateDirectoryDialog: noOp, patchSession: noOp, updateSession: noOp,
      loadDirectory: async () => true, removeSessionWorkspaceState: noOp,
      removeSessionScriptStates: noOp, removeSessionPerformanceState: noOp,
      previewActionsRef: useRef(new Map()), directoryLoadIdsRef: useRef(new Map()),
      connectingSessionsRef: useRef(new Set()), setSearchOpen: noOp, showToast: noOp,
    })
    current = { sessions, activeId, ref: sessionsRef.current }
    return createElement(SessionTabBar, { sessions, profiles: [profile], activeSessionId: activeId, actions: operations, onAdd: noOp })
  }
  act(() => root.render(createElement(Harness)))
  const list = host.querySelector<HTMLElement>('.session-tab-list')!
  list.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300 } as DOMRect)
  for (const tab of host.querySelectorAll<HTMLElement>('.session-tab')) {
    tab.getBoundingClientRect = () => ({ left: 100, right: 200, width: 100 } as DOMRect)
  }
  return {
    host, list, disconnected, connections,
    get operations() { return operations },
    get current() { return current },
    ids: () => Array.from(host.querySelectorAll<HTMLElement>('.session-tab'), (tab) => tab.dataset.sessionId),
    button: (id: string) => host.querySelector<HTMLButtonElement>('#session-tab-' + id)!,
    dispose() { act(() => root.unmount()); host.remove() },
  }
}

function transfer(types: string[] = []) {
  const data = new Map<string, string>()
  return {
    types, effectAllowed: 'uninitialized', dropEffect: 'none',
    setData(type: string, value: string) { data.set(type, value); if (!types.includes(type)) types.push(type) },
    getData(type: string) { return data.get(type) ?? '' },
  }
}

function drag(target: Element, type: string, dataTransfer: ReturnType<typeof transfer>, clientX = 120) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  act(() => target.dispatchEvent(event))
  return event
}

test('dragging inserts file and terminal tabs in either direction without changing active session or connection state', async () => {
  const tabs = await mountTabs()
  const originals = new Map(tabs.current.sessions.map((item) => [item.id, item]))
  try {
    const data = transfer()
    drag(tabs.button('first'), 'dragstart', data)
    assert.equal(data.effectAllowed, 'move')
    drag(tabs.button('third').querySelector('span')!, 'dragover', data, 180)
    assert.ok(tabs.button('third').parentElement!.classList.contains('drop-after'))
    drag(tabs.button('third'), 'drop', data, 180)
    assert.deepEqual(tabs.ids(), ['second', 'third', 'first'])
    assert.equal(tabs.current.activeId, 'first')
    assert.equal(tabs.host.querySelector('.dragging, .drop-before, .drop-after'), null)

    const next = transfer()
    drag(tabs.button('third'), 'dragstart', next)
    drag(tabs.button('second'), 'dragover', next)
    assert.ok(tabs.button('second').parentElement!.classList.contains('drop-before'))
    drag(tabs.button('second'), 'drop', next)
    assert.deepEqual(tabs.ids(), ['third', 'second', 'first'])
    for (const item of tabs.current.sessions) assert.equal(item, originals.get(item.id))
    assert.equal(tabs.current.sessions, tabs.current.ref)
    assert.deepEqual(tabs.connections, [])
    assert.deepEqual(tabs.disconnected, [])
  } finally { tabs.dispose() }
})

test('dragging to blank space appends a tab and scrolling at either edge remains available', async () => {
  const tabs = await mountTabs()
  try {
    const data = transfer()
    drag(tabs.button('first'), 'dragstart', data)
    tabs.list.scrollLeft = 40
    drag(tabs.button('third'), 'dragover', data, 299)
    assert.equal(tabs.list.scrollLeft, 60)
    drag(tabs.button('second'), 'dragover', data, 1)
    assert.equal(tabs.list.scrollLeft, 40)
    drag(tabs.list, 'drop', data, 250)
    assert.deepEqual(tabs.ids(), ['second', 'third', 'first'])
  } finally { tabs.dispose() }
})

test('cancelled drags, self drops, and external files never reorder sessions', async () => {
  const tabs = await mountTabs()
  try {
    const data = transfer()
    drag(tabs.button('first'), 'dragstart', data)
    drag(tabs.button('third'), 'dragover', data)
    drag(tabs.button('first'), 'dragend', data)
    assert.equal(tabs.host.querySelector('.dragging, .drop-before, .drop-after'), null)
    assert.equal(drag(tabs.button('third'), 'drop', transfer(['Files'])).defaultPrevented, false)
    // Even an external drag with the same MIME type has no local drag source.
    assert.equal(drag(tabs.button('third'), 'drop', data).defaultPrevented, false)
    drag(tabs.button('first'), 'dragstart', data)
    drag(tabs.button('first'), 'drop', data)
    assert.deepEqual(tabs.ids(), ['first', 'second', 'third'])
    assert.equal(tabs.button('first').draggable, true)
    assert.equal(tabs.host.querySelector<HTMLButtonElement>('.session-tab-close')!.draggable, false)
  } finally { tabs.dispose() }
})

test('keyboard reordering preserves focus, respects boundaries, and closing uses the new neighboring tab', async () => {
  const tabs = await mountTabs()
  const key = (id: string, key: string) => act(() => {
    tabs.button(id).dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
  })
  try {
    tabs.button('first').focus()
    key('first', 'ArrowLeft')
    assert.deepEqual(tabs.ids(), ['first', 'second', 'third'])
    key('first', 'ArrowRight')
    assert.deepEqual(tabs.ids(), ['second', 'first', 'third'])
    assert.equal(document.activeElement, tabs.button('first'))
    key('first', 'ArrowRight')
    key('first', 'ArrowRight')
    assert.deepEqual(tabs.ids(), ['second', 'third', 'first'])
    key('first', 'ArrowLeft')
    assert.deepEqual(tabs.ids(), ['second', 'first', 'third'])
    assert.equal(tabs.current.activeId, 'first')
    act(() => tabs.button('first').parentElement!.querySelector<HTMLButtonElement>('.session-tab-close')!.click())
    assert.deepEqual(tabs.ids(), ['second', 'third'])
    assert.equal(tabs.current.activeId, 'third')
    assert.deepEqual(tabs.disconnected, ['first'])
  } finally { tabs.dispose() }
})

test('reorder uses the latest session list and ignores tabs closed during a drag', async () => {
  const tabs = await mountTabs()
  try {
    act(() => {
      tabs.operations.reorderSession('first', 'third', 'after')
      tabs.operations.reorderSession('second', 'first', 'after')
    })
    assert.deepEqual(tabs.ids(), ['third', 'first', 'second'])
    const data = transfer()
    drag(tabs.button('second'), 'dragstart', data)
    act(() => tabs.operations.closeSession('second'))
    drag(tabs.button('third'), 'drop', data)
    assert.deepEqual(tabs.ids(), ['third', 'first'])
    act(() => tabs.operations.reorderSession('third', 'second', 'before'))
    assert.deepEqual(tabs.ids(), ['third', 'first'])
  } finally { tabs.dispose() }
})

test('a single session is not draggable', async () => {
  const tabs = await mountTabs([session('only')])
  try { assert.equal(tabs.button('only').draggable, false) } finally { tabs.dispose() }
})
