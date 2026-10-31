import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, Fragment } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type {
  NameSearchEvent,
  NameSearchRequest,
  PreviewResult,
  RemoteFilesApi,
} from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
import FileSessionWorkspace, { type SessionFileWorkspaceActions } from '../src/renderer/src/features/files/FileSessionWorkspace.tsx'
import type { SessionTab } from '../src/renderer/src/app-types.ts'
import type { FileContextMenuContext, FileMenuAction } from '../src/renderer/src/features/files/file-menu.ts'

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

function session(id: string): SessionTab {
  return {
    id,
    profileId: 'profile-' + id,
    kind: 'files',
    status: 'connected',
    currentPath: '/home/user',
    startPath: '/',
    entries: [],
    selectedPaths: [],
    loading: false,
    viewMode: 'details',
    sort: { column: 'name', direction: 'ascending' },
    highlightedPath: null,
    history: ['/home/user'],
    historyIndex: 0,
    error: null,
  }
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input.tagName === 'TEXTAREA'
    ? dom.window.HTMLTextAreaElement.prototype
    : dom.window.HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}

test('file workspaces retain independent search and preview state across session switches', async () => {
  const { createRoot } = await import('react-dom/client')
  const nameListeners = new Set<(event: NameSearchEvent) => void>()
  const requests: NameSearchRequest[] = []
  const cancelledRequests: string[] = []
  const previewCalls: Array<{ sessionId: string; path: string }> = []
  const releasedTokens: string[] = []
  const blockingSessionIds = new Set<string>()
  const remoteFiles = {
    onNameSearchEvent: (listener: (event: NameSearchEvent) => void) => {
      nameListeners.add(listener)
      return () => nameListeners.delete(listener)
    },
    onContentSearchEvent: () => () => {},
    startNameSearch: async (request: NameSearchRequest) => { requests.push(request) },
    cancelNameSearch: async (requestId: string) => {
      cancelledRequests.push(requestId)
      return true
    },
    startContentSearch: async () => {},
    cancelContentSearch: async () => true,
    previewFile: async (sessionId: string, path: string): Promise<PreviewResult> => {
      previewCalls.push({ sessionId, path })
      if (path.endsWith('.png')) return { type: 'image', name: 'cover.png', url: 'file:///preview', token: 'preview-token-' + sessionId }
      return {
        type: 'text',
        name: 'notes.txt',
        content: 'initial text',
        lineEnding: '\n', encoding: 'utf8', bom: false, version: { hash: 'a'.repeat(64), identity: 'fixture' },
      }
    },
    readLogPreview: async () => ({ name: 'app.log', content: 'tail target', startOffset: 100, fileSize: 111, limitBytes: 1000, hasEarlier: true }),
    releasePreview: async (token: string) => { releasedTokens.push(token) },
  } as unknown as RemoteFilesApi
  window.remoteFiles = remoteFiles

  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const first = session('first')
  const second = session('second')
  const noOp = () => {}
  const previewActions = new Map<string, SessionFileWorkspaceActions>()
  const registerWorkspaceActions = (sessionId: string, actions: SessionFileWorkspaceActions | null) => {
    if (actions) previewActions.set(sessionId, actions)
    else previewActions.delete(sessionId)
  }
  const onBlockingChange = (sessionId: string, blocking: boolean) => {
    if (blocking) blockingSessionIds.add(sessionId)
    else blockingSessionIds.delete(sessionId)
  }
  const onMenuAction = (action: FileMenuAction, context: FileContextMenuContext, sessionId: string) => {
    if (action.type !== 'preview') return
    const entry = context.kind === 'search-result' ? context.result
      : context.kind === 'single-entry' ? context.entry
        : null
    if (entry) void previewActions.get(sessionId)?.previewFile(entry, action.previewType)
  }
  const render = (activeSessionId: string | null) => createElement(Fragment, null,
    createElement(FileSessionWorkspace, {
      session: first,
      active: activeSessionId === first.id,
      searchOpen: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      showToast: noOp,
      onSearchOpenChange: noOp,
      onWorkspaceOpenChange: noOp,
      onBlockingChange,
      onRegisterWorkspaceActions: registerWorkspaceActions,
      onMenuAction,
      onOpenExternalLink: noOp,
    }),
    createElement(FileSessionWorkspace, {
      session: second,
      active: activeSessionId === second.id,
      searchOpen: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      showToast: noOp,
      onSearchOpenChange: noOp,
      onWorkspaceOpenChange: noOp,
      onBlockingChange,
      onRegisterWorkspaceActions: registerWorkspaceActions,
      onMenuAction,
      onOpenExternalLink: noOp,
    }),
  )

  try {
    act(() => root.render(render(first.id)))
    const firstWorkspace = host.querySelectorAll<HTMLElement>('.session-workspace-layer')[0]
    const secondWorkspace = host.querySelectorAll<HTMLElement>('.session-workspace-layer')[1]
    for (const [workspace, query] of [[firstWorkspace, 'first.txt'], [secondWorkspace, 'second.txt']] as const) {
      setInputValue(workspace.querySelector<HTMLInputElement>('.search-query-field input')!, query)
      await act(async () => {
        workspace.querySelector<HTMLButtonElement>('.search-form-actions button[type="submit"]')!.click()
        await Promise.resolve()
      })
    }
    assert.deepEqual(requests.map(({ sessionId }) => sessionId), ['first', 'second'])

    act(() => {
      for (const request of requests) {
        const results = request.sessionId === first.id
          ? [
              { name: 'notes.txt', path: '/home/user/notes.txt', type: 'file' as const },
              { name: 'cover.png', path: '/home/user/cover.png', type: 'file' as const },
            ]
          : [{ name: 'second.txt', path: '/home/user/second.txt', type: 'file' as const }]
        const event: NameSearchEvent = {
          type: 'results',
          requestId: request.requestId,
          sessionId: request.sessionId,
          profileId: request.profileId,
          elapsedMs: 12,
          matchedFiles: results.length,
          incomplete: false,
          hasReadErrors: false,
          results,
        }
        for (const listener of nameListeners) listener(event)
      }
    })
    assert.equal(firstWorkspace.querySelectorAll('.name-search-result').length, 2)
    assert.equal(secondWorkspace.querySelectorAll('.name-search-result').length, 1)

    act(() => firstWorkspace.querySelector<HTMLButtonElement>('.name-search-result')!.click())
    const textPreviewAction = Array.from(firstWorkspace.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.trim() === '预览')
    assert.ok(textPreviewAction)
    await act(async () => {
      textPreviewAction!.click()
      await Promise.resolve()
    })
    const editor = firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')!
    setInputValue(editor, 'edited text')
    act(() => previewActions.get(first.id)!.requestSearch(true))
    const textSearch = firstWorkspace.querySelector<HTMLInputElement>('[aria-label="搜索文本"]')!
    assert.ok(textSearch)
    setInputValue(textSearch, 'text')
    assert.equal(firstWorkspace.querySelector('.text-preview-search-count')?.textContent, '1 / 1')
    assert.equal(document.querySelector('.confirmation-backdrop'), null)
    assert.deepEqual(previewCalls[0], { sessionId: first.id, path: '/home/user/notes.txt' })

    act(() => root.render(render(second.id)))
    assert.equal(firstWorkspace.classList.contains('active'), false)
    assert.equal(secondWorkspace.classList.contains('active'), true)
    assert.equal(secondWorkspace.querySelector('.text-preview-editor'), null)
    act(() => root.render(render(first.id)))
    assert.equal(firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.value, 'edited text')
    assert.equal(firstWorkspace.querySelector<HTMLInputElement>('[aria-label="搜索文本"]')?.value, 'text')
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.equal(firstWorkspace.querySelector('[aria-label="搜索文本"]'), null)
    assert.equal(firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.value, 'edited text')

    act(() => firstWorkspace.querySelector<HTMLButtonElement>('.text-preview-save')!.click())
    assert.equal(blockingSessionIds.has(first.id), true)
    act(() => previewActions.get(first.id)!.requestSearch())
    assert.equal(firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.value, 'edited text')
    const confirmation = document.body.querySelector<HTMLElement>('.confirmation-backdrop')
    assert.ok(confirmation)
    act(() => Array.from(confirmation!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '取消')!.click())
    assert.equal(blockingSessionIds.has(first.id), false)

    act(() => previewActions.get(first.id)!.requestSearch())
    let discard = document.body.querySelector<HTMLElement>('.confirmation-backdrop')!
    assert.ok(discard.textContent?.includes('放弃未保存的修改'))
    act(() => previewActions.get(first.id)!.requestSearch())
    assert.equal(document.querySelectorAll('.confirmation-backdrop').length, 1)
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    assert.equal(document.querySelector('.confirmation-backdrop'), null)
    assert.equal(firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.value, 'edited text')
    assert.ok(document.activeElement === editor)
    act(() => previewActions.get(first.id)!.requestSearch())
    discard = document.body.querySelector<HTMLElement>('.confirmation-backdrop')!
    act(() => Array.from(discard.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '放弃修改并搜索')!.click())
    assert.equal(firstWorkspace.querySelector('.text-preview-editor'), null)
    assert.equal(firstWorkspace.querySelector<HTMLInputElement>('.search-query-field input')?.value, 'first.txt')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    assert.ok(document.activeElement === firstWorkspace.querySelector('.search-modal .modal-close'))
    assert.equal(requests.length, 2)

    act(() => firstWorkspace.querySelectorAll<HTMLButtonElement>('.name-search-result')[1].click())
    const imagePreviewAction = Array.from(firstWorkspace.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('预览'))
    assert.ok(imagePreviewAction)
    await act(async () => {
      imagePreviewAction!.click()
      await Promise.resolve()
    })

    act(() => previewActions.get(first.id)!.requestSearch())
    assert.equal(firstWorkspace.querySelector('.preview-backdrop'), null)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    assert.deepEqual(releasedTokens, ['preview-token-first'])
    await act(async () => { await previewActions.get(first.id)!.previewLogFile({ name: 'app.log', path: '/app.log' }) })
    act(() => previewActions.get(first.id)!.requestSearch(true))
    assert.ok(firstWorkspace.querySelector('.log-preview-text'))
    assert.ok(firstWorkspace.querySelector('[aria-label="搜索文本"]'))
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    assert.equal(firstWorkspace.querySelector('[aria-label="搜索文本"]'), null)
    assert.ok(firstWorkspace.querySelector('.log-preview-text'))
    act(() => root.unmount())
    assert.deepEqual(cancelledRequests.sort(), requests.map(({ requestId }) => requestId).sort())
    assert.deepEqual(releasedTokens, ['preview-token-first'])
  } finally {
    if (host.isConnected) act(() => root.unmount())
    host.remove()
  }
})

test('audio workspaces pause hidden sessions, retain progress and release tokens on Escape, replacement and disconnect', async () => {
  const { createRoot } = await import('react-dom/client')
  const released: string[] = []
  const played: HTMLMediaElement[] = []
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  const prototype = dom.window.HTMLMediaElement.prototype
  const originals = Object.getOwnPropertyDescriptors(prototype)
  Object.defineProperties(prototype, {
    paused: { configurable: true, get() { return paused.get(this) ?? true } },
    duration: { configurable: true, get() { return 120 } },
    play: { configurable: true, value(this: HTMLMediaElement) {
      played.push(this); paused.set(this, false)
      this.dispatchEvent(new dom.window.Event('play'))
      return Promise.resolve()
    } },
    pause: { configurable: true, value(this: HTMLMediaElement) {
      paused.set(this, true); this.dispatchEvent(new dom.window.Event('pause'))
    } },
    load: { configurable: true, value() {} },
  })
  let finishPreview: (result: PreviewResult) => void
  window.remoteFiles = {
    previewFile: async (sessionId: string, path: string): Promise<PreviewResult> => path === '/pending.mp3'
      ? new Promise((resolve) => { finishPreview = resolve })
      : { type: 'audio', name: path.slice(1), url: 'http://localhost/' + sessionId, token: sessionId + path },
    releasePreview: async (token: string) => { released.push(token) },
  } as unknown as RemoteFilesApi
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const first = session('audio-first')
  const second = session('audio-second')
  const actions = new Map<string, SessionFileWorkspaceActions>()
  const noOp = () => {}
  const register = (id: string, value: SessionFileWorkspaceActions | null) => {
    if (value) actions.set(id, value)
    else actions.delete(id)
  }
  const render = (activeId: string) => act(() => root.render(createElement(Fragment, null,
    ...[first, second].map((session) => createElement(FileSessionWorkspace, {
      key: session.id, session, active: session.id === activeId, searchOpen: false,
      fileTypeExtensions: defaultFileTypeExtensions(), showToast: noOp, onSearchOpenChange: noOp,
      onWorkspaceOpenChange: noOp, onBlockingChange: noOp, onRegisterWorkspaceActions: register,
      onMenuAction: noOp, onOpenExternalLink: noOp,
    })),
  )))
  const open = async (id: string, name = 'track.mp3') => {
    await act(async () => { await actions.get(id)!.previewFile({ name, path: '/' + name }, 'audio') })
  }
  const escape = () => act(() => {
    window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  })
  const flushRelease = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  try {
    render(first.id)
    await open(first.id)
    const audio = host.querySelector('audio')!
    assert.equal(played.length, 1)
    audio.currentTime = 37
    render(second.id)
    assert.equal(audio.paused, true)
    await open(second.id)
    const secondAudio = host.querySelectorAll('audio')[1]
    act(() => secondAudio.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })))
    assert.equal(secondAudio.currentTime, 5)
    assert.equal(audio.currentTime, 37)
    render(first.id)
    assert.equal(audio.paused, true)
    assert.equal(played.length, 2)
    assert.equal(audio.currentTime, 37)
    await open(first.id, 'replacement.mp3')
    await flushRelease()
    assert.equal(audio.getAttribute('src'), null)
    assert.deepEqual(released, ['audio-first/track.mp3'])
    first.status = 'disconnected'
    render(first.id)
    await flushRelease()
    assert.equal(host.querySelectorAll('audio').length, 1)
    assert.deepEqual(released, ['audio-first/track.mp3', 'audio-first/replacement.mp3'])
    first.status = 'connected'
    render(first.id)
    let pending: Promise<void>
    act(() => { pending = actions.get(first.id)!.previewFile({ name: 'pending.mp3', path: '/pending.mp3' }, 'audio') })
    render(second.id)
    const previousPlays = played.length
    await act(async () => {
      finishPreview!({ type: 'audio', name: 'pending.mp3', url: 'http://localhost/pending', token: 'pending' })
      await pending!
    })
    assert.equal(played.length, previousPlays)
    escape() // Only the active second session closes.
    await flushRelease()
    assert.ok(released.includes('audio-second/track.mp3'))
    assert.equal(host.querySelectorAll('audio').length, 1)
    render(first.id)
    assert.equal(played.length, previousPlays)
    escape()
    await flushRelease()
    assert.equal(host.querySelector('audio'), null)
    assert.equal(released.filter((token) => token === 'pending').length, 1)
    await open(first.id, 'unmount.mp3')
    act(() => root.unmount())
    assert.ok(released.includes('audio-first/unmount.mp3'))
  } finally {
    act(() => root.unmount())
    host.remove()
    Object.defineProperties(prototype, originals)
  }
})
