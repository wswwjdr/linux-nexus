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
import SftpSessionWorkspace, { type SessionPreviewActions } from '../src/renderer/src/components/SftpSessionWorkspace.tsx'
import type { SessionTab } from '../src/renderer/src/app-types.ts'
import type { SftpContextMenuContext, SftpMenuAction } from '../src/renderer/src/context-menu/sftp-menu.ts'

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
    kind: 'sftp',
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

test('SFTP workspaces retain independent search and preview state across session switches', async () => {
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
        revision: { contentHash: 'hash', lineEnding: '\n' },
      }
    },
    readLogPreview: async () => {
      throw new Error('not used')
    },
    releasePreview: async (token: string) => { releasedTokens.push(token) },
  } as unknown as RemoteFilesApi
  window.remoteFiles = remoteFiles

  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const first = session('first')
  const second = session('second')
  const noOp = () => {}
  const previewActions = new Map<string, SessionPreviewActions>()
  const registerPreviewActions = (sessionId: string, actions: SessionPreviewActions | null) => {
    if (actions) previewActions.set(sessionId, actions)
    else previewActions.delete(sessionId)
  }
  const onBlockingChange = (sessionId: string, blocking: boolean) => {
    if (blocking) blockingSessionIds.add(sessionId)
    else blockingSessionIds.delete(sessionId)
  }
  const onMenuAction = (action: SftpMenuAction, context: SftpContextMenuContext, sessionId: string) => {
    if (action.type !== 'preview') return
    const entry = context.kind === 'search-result' ? context.result
      : context.kind === 'single-entry' ? context.entry
        : null
    if (entry) void previewActions.get(sessionId)?.previewFile(entry, action.previewType)
  }
  const render = (activeSessionId: string | null) => createElement(Fragment, null,
    createElement(SftpSessionWorkspace, {
      session: first,
      active: activeSessionId === first.id,
      searchOpen: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      showToast: noOp,
      onSearchOpenChange: noOp,
      onWorkspaceOpenChange: noOp,
      onBlockingChange,
      onRegisterPreviewActions: registerPreviewActions,
      onMenuAction,
      onOpenExternalLink: noOp,
    }),
    createElement(SftpSessionWorkspace, {
      session: second,
      active: activeSessionId === second.id,
      searchOpen: true,
      fileTypeExtensions: defaultFileTypeExtensions(),
      showToast: noOp,
      onSearchOpenChange: noOp,
      onWorkspaceOpenChange: noOp,
      onBlockingChange,
      onRegisterPreviewActions: registerPreviewActions,
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
    assert.deepEqual(previewCalls[0], { sessionId: first.id, path: '/home/user/notes.txt' })

    act(() => root.render(render(second.id)))
    assert.equal(firstWorkspace.classList.contains('active'), false)
    assert.equal(secondWorkspace.classList.contains('active'), true)
    assert.equal(secondWorkspace.querySelector('.text-preview-editor'), null)
    act(() => root.render(render(first.id)))
    assert.equal(firstWorkspace.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.value, 'edited text')

    act(() => firstWorkspace.querySelector<HTMLButtonElement>('.text-preview-save')!.click())
    assert.equal(blockingSessionIds.has(first.id), true)
    const confirmation = document.body.querySelector<HTMLElement>('.confirmation-backdrop')
    assert.ok(confirmation)
    act(() => Array.from(confirmation!.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === '取消')!.click())
    assert.equal(blockingSessionIds.has(first.id), false)

    act(() => firstWorkspace.querySelector<HTMLButtonElement>('button[aria-label="关闭预览"]')!.click())
    act(() => firstWorkspace.querySelectorAll<HTMLButtonElement>('.name-search-result')[1].click())
    const imagePreviewAction = Array.from(firstWorkspace.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('预览'))
    assert.ok(imagePreviewAction)
    await act(async () => {
      imagePreviewAction!.click()
      await Promise.resolve()
    })

    act(() => root.unmount())
    assert.deepEqual(cancelledRequests.sort(), requests.map(({ requestId }) => requestId).sort())
    assert.deepEqual(releasedTokens, ['preview-token-first'])
  } finally {
    if (host.isConnected) act(() => root.unmount())
    host.remove()
  }
})
