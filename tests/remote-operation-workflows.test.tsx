import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type DragEvent } from 'react'
import { JSDOM } from 'jsdom'
import type { OperationExecutionRequest, OperationExecutionResult, RemoteFilesApi, RemoteEntry, ServerProfile } from '../src/shared/types.ts'
import type { SessionTab } from '../src/renderer/src/app-types.ts'
import { useRemoteOperations } from '../src/renderer/src/features/remote-files/useRemoteOperations.ts'
import { useRemoteFileShortcuts } from '../src/renderer/src/features/files/useRemoteFileShortcuts.ts'
import { useFileDragAndDrop } from '../src/renderer/src/features/files/useFileDragAndDrop.ts'

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

const sources: RemoteEntry[] = [
  { name: 'a.txt', path: '/source/a.txt', type: 'file', size: 10, modifiedAt: null, permissions: '' },
  { name: 'folder', path: '/source/folder', type: 'directory', size: 0, modifiedAt: null, permissions: '' },
]
const target: RemoteEntry = { name: 'dest', path: '/target/dest', type: 'directory', size: 0, modifiedAt: null, permissions: '' }
const profile: ServerProfile = { id: 'profile', name: 'server', host: 'host', port: 22, username: 'user', pinned: false }

function session(id: string, currentPath: string): SessionTab {
  return {
    id, currentPath, profileId: profile.id, kind: 'files', status: 'connected', startPath: '/',
    entries: sources, selectedPaths: sources.map(({ path }) => path), loading: false,
    viewMode: 'details', sort: { column: 'name', direction: 'ascending' }, highlightedPath: null,
    history: [currentPath], historyIndex: 0, error: null,
  }
}

async function mountWorkflow({ hold = false, failure = '' } = {}) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const requests: OperationExecutionRequest[] = []
  const cancelled: string[] = []
  const refreshed: string[] = []
  const notices: Array<{ kind: string; message: string }> = []
  const renames: Array<{ sessionId: string; path: string; name: string }> = []
  const sessionsRef = { current: [session('active', '/target'), session('source', '/source'), session('nested', '/target/release')] }
  let connectedProfile = profile
  let finish!: (status?: OperationExecutionResult['status']) => void
  let operations!: ReturnType<typeof useRemoteOperations>
  let drag!: ReturnType<typeof useFileDragAndDrop>
  const api = {
    executeOperation: async (request: OperationExecutionRequest) => {
      requests.push(request)
      if (failure) throw new Error(failure)
      if (hold) return new Promise<OperationExecutionResult>((resolve) => {
        finish = (status = 'completed') => resolve({ status, requestId: request.requestId, operation: request.operation, command: 'server command' })
      })
      return { status: 'completed', requestId: request.requestId, operation: request.operation, command: 'server command' }
    },
    cancelOperation: async (requestId: string) => { cancelled.push(requestId); finish('cancelled'); return true },
    renameRemoteEntry: async (sessionId: string, path: string, name: string) => {
      renames.push({ sessionId, path, name })
      if (failure) throw new Error(failure)
      return path.slice(0, path.lastIndexOf('/') + 1) + name
    },
  } as RemoteFilesApi
  Object.defineProperty(window, 'remoteFiles', { configurable: true, value: api })

  function Harness() {
    const activeSession = sessionsRef.current[0]
    operations = useRemoteOperations({
      activeSession, connectedProfile, connectedSessionId: activeSession.id,
      currentPath: activeSession.currentPath, sessionsRef,
      updateSession: (id, update) => { sessionsRef.current = sessionsRef.current.map((item) => item.id === id ? update(item) : item) },
      loadDirectory: async (id) => { refreshed.push(id); return true },
      showToast: (kind, message) => notices.push({ kind, message }), setBrowserContextMenu: () => {},
    })
    useRemoteFileShortcuts({
      activeSession, activeSessionId: activeSession.id, shortcutGuideOpen: false,
      searchOpenSessionIds: new Set(), setSearchOpen: () => {}, modalOpen: false,
      workspaceOpenSessionIds: new Set(), browserContextMenu: null, sessionContextMenu: null,
      sortedEntries: sources, canPasteRemote: operations.canPasteRemote,
      copyRemoteSelection: operations.copyRemoteSelection, cutRemoteSelection: operations.cutRemoteSelection,
      pasteRemoteEntries: () => operations.pasteRemoteEntries(activeSession.currentPath, 'force'),
    })
    drag = useFileDragAndDrop({
      sortedEntries: [...sources, target], selectedPathsRef: { current: activeSession.selectedPaths },
      operationActive: operations.activeOperation !== null, onDropUpload: () => {},
      onDropMove: operations.beginRemoteMove, onDropError: (error) => { throw error }, onDragStart: () => {},
    })
    return null
  }
  await act(async () => { root.render(createElement(Harness)) })
  return {
    get operations() { return operations }, get drag() { return drag }, requests, cancelled, refreshed, notices, renames, sessionsRef,
    finish: (status?: OperationExecutionResult['status']) => finish(status),
    async changeProfile(next: ServerProfile) {
      connectedProfile = next
      await act(async () => { root.render(createElement(Harness)) })
    },
    async select(paths: string[]) {
      sessionsRef.current[0] = { ...sessionsRef.current[0], selectedPaths: paths }
      await act(async () => { root.render(createElement(Harness)) })
    },
    unmount() { act(() => root.unmount()); host.remove() },
  }
}

async function run(action: () => void) {
  await act(async () => { action(); await Promise.resolve() })
}

function key(key: string) {
  window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }))
}

test('folder rename keeps the invoking session, remaps descendant tabs and clipboard, and refreshes affected directories', async () => {
  const view = await mountWorkflow()
  const inside = {
    ...session('inside', '/source/folder/nested'), startPath: '/source/folder',
    selectedPaths: ['/source/folder/nested/a.txt'], highlightedPath: '/source/folder/nested/a.txt',
    entries: [{ ...sources[0], path: '/source/folder/nested/a.txt' }],
  }
  const otherProfile = { ...session('other-profile', '/source/folder'), profileId: 'different' }
  const sibling = session('sibling', '/source/folder-extra')
  view.sessionsRef.current.push(inside, otherProfile, sibling)
  try {
    await run(() => view.operations.copyRemoteSelection([sources[1]]))
    await run(() => view.operations.requestRemoteEntryRename(sources[1], 'source'))
    await act(async () => { await view.operations.submitRemoteEntryRename('renamed folder') })
    assert.deepEqual(view.renames, [{ sessionId: 'source', path: '/source/folder', name: 'renamed folder' }])
    assert.equal(view.operations.renameEntryDialog, null)
    const source = view.sessionsRef.current.find(({ id }) => id === 'source')!
    assert.equal(source.entries[1].name, 'renamed folder')
    assert.equal(source.entries[1].path, '/source/renamed folder')
    assert.deepEqual(source.selectedPaths, ['/source/a.txt', '/source/renamed folder'])
    const nested = view.sessionsRef.current.find(({ id }) => id === 'inside')!
    assert.equal(nested.currentPath, '/source/renamed folder/nested')
    assert.equal(nested.startPath, '/source/renamed folder')
    assert.deepEqual(nested.history, ['/source/renamed folder/nested'])
    assert.deepEqual(nested.selectedPaths, ['/source/renamed folder/nested/a.txt'])
    assert.equal(nested.entries[0].path, '/source/renamed folder/nested/a.txt')
    assert.equal(nested.highlightedPath, '/source/renamed folder/nested/a.txt')
    assert.equal(view.sessionsRef.current.find(({ id }) => id === 'other-profile'), otherProfile)
    assert.equal(view.sessionsRef.current.find(({ id }) => id === 'sibling')?.currentPath, sibling.currentPath)
    assert.deepEqual(view.operations.remoteClipboard?.sourcePaths, ['/source/renamed folder'])
    assert.deepEqual(view.refreshed.sort(), ['inside', 'source'])
    assert.ok(view.notices.some(({ message }) => message === '已重命名'))
  } finally { view.unmount() }
})

test('rename failure preserves the dialog and recorded paths; an unchanged name closes without an API call', async () => {
  const view = await mountWorkflow({ failure: '同名文件或文件夹已存在' })
  try {
    await run(() => view.operations.requestRemoteEntryRename(sources[0], 'source'))
    await act(async () => {
      await assert.rejects(view.operations.submitRemoteEntryRename('exists.txt'), /同名文件或文件夹已存在/)
    })
    assert.equal(view.operations.renameEntryDialog?.entry.path, sources[0].path)
    assert.equal(view.sessionsRef.current[1].entries[0].path, sources[0].path)
    assert.deepEqual(view.refreshed, [])
    await act(async () => { await view.operations.submitRemoteEntryRename('a.txt') })
    assert.equal(view.operations.renameEntryDialog, null)
    assert.equal(view.renames.length, 1)
  } finally { view.unmount() }
})

test('Ctrl+C/X only record sources; Ctrl+V executes immediately and preserves copy records', async () => {
  const view = await mountWorkflow()
  try {
    await run(() => key('c'))
    assert.equal(view.requests.length, 0)
    assert.deepEqual(view.operations.remoteClipboard?.sourcePaths, sources.map(({ path }) => path))
    await run(() => key('v'))
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].operation, 'copy')
    assert.equal(view.requests[0].strategy, 'force')
    assert.equal(view.requests[0].targetDirectory, '/target')
    assert.ok(view.operations.remoteClipboard)
    assert.equal(document.querySelector('[role="alertdialog"]'), null)
    await run(() => key('x'))
    assert.equal(view.requests.length, 1)
    await run(() => key('v'))
    assert.equal(view.requests[1].operation, 'move')
    assert.equal(view.operations.remoteClipboard, null)
    assert.ok(view.refreshed.includes('active') && view.refreshed.includes('source') && view.refreshed.includes('nested'))
  } finally { view.unmount() }
})

test('paste skip executes directly and retains cut records; server changes disable paste', async () => {
  const view = await mountWorkflow()
  try {
    await run(() => view.operations.cutRemoteSelection(sources))
    await run(() => view.operations.pasteRemoteEntries('/other', 'skip'))
    assert.equal(view.requests[0].strategy, 'skip')
    assert.equal(view.requests[0].targetDirectory, '/other')
    assert.ok(view.operations.remoteClipboard)
    for (const changed of [{ ...profile, host: 'another' }, { ...profile, id: 'other' }, { ...profile, port: 2222 }, { ...profile, username: 'other' }]) {
      await view.changeProfile(changed)
      assert.equal(view.operations.canPasteRemote, false)
      await run(() => view.operations.pasteRemoteEntries('/target'))
    }
    assert.equal(view.requests.length, 1)
  } finally { view.unmount() }
})

test('Ctrl+C replaces an earlier clipboard entry with the current selection before same-directory paste', async () => {
  const view = await mountWorkflow()
  try {
    await view.select([sources[1].path])
    await run(() => key('c'))
    assert.deepEqual(view.operations.remoteClipboard?.sourcePaths, [sources[1].path])
    view.sessionsRef.current[0].currentPath = '/source'
    await view.select([sources[0].path])
    await run(() => key('c'))
    await run(() => key('v'))
    assert.equal(view.requests.length, 1)
    assert.deepEqual(view.requests[0].sourcePaths, [sources[0].path])
    assert.equal(view.requests[0].targetDirectory, '/source')
    assert.deepEqual(view.operations.remoteClipboard?.sourcePaths, [sources[0].path])
  } finally { view.unmount() }
})

test('drag start only records paths; drop executes one forced native move', async () => {
  const view = await mountWorkflow()
  const data = new Map<string, string>()
  const event = {
    dataTransfer: {
      types: ['application/x-linux-nexus-remote-files'],
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }, preventDefault() {}, stopPropagation() {},
  } as unknown as DragEvent<HTMLElement>
  try {
    await run(() => view.drag.handleEntryDragStart(sources[1], event))
    assert.equal(view.requests.length, 0)
    await run(() => { view.drag.handleEntryDrop(target, event); view.drag.handleEntryDrop(target, event) })
    assert.equal(view.requests.length, 1)
    assert.equal(view.requests[0].operation, 'move')
    assert.equal(view.requests[0].strategy, 'force')
    assert.deepEqual(view.requests[0].sourcePaths, sources.map(({ path }) => path))
    assert.equal(view.requests[0].targetDirectory, target.path)
  } finally { view.unmount() }
})

test('pending commands block repeated submissions, expose cancellation and keep cut records', async () => {
  const view = await mountWorkflow({ hold: true })
  try {
    await run(() => view.operations.cutRemoteSelection(sources))
    await run(() => { view.operations.pasteRemoteEntries('/target'); view.operations.pasteRemoteEntries('/target') })
    assert.equal(view.requests.length, 1)
    assert.equal(view.operations.activeOperation?.operation, 'move')
    assert.equal(view.operations.canPasteRemote, false)
    await run(() => view.operations.cancelActiveOperation())
    assert.deepEqual(view.cancelled, [view.requests[0].requestId])
    assert.equal(view.operations.activeOperation, null)
    assert.ok(view.operations.remoteClipboard)
    assert.ok(view.notices.some(({ message }) => message === '移动已取消'))
    assert.ok(view.refreshed.includes('source'))
  } finally { view.unmount() }
})

test('completed move does not erase a newer cut selection', async () => {
  const view = await mountWorkflow({ hold: true })
  try {
    await run(() => view.operations.cutRemoteSelection(sources))
    await run(() => view.operations.pasteRemoteEntries('/target'))
    await run(() => view.operations.cutRemoteSelection([sources[0]]))
    await run(() => view.finish())
    assert.deepEqual(view.operations.remoteClipboard?.sourcePaths, [sources[0].path])
  } finally { view.unmount() }
})

test('move errors are visible, preserve cut records and refresh affected directories', async () => {
  const view = await mountWorkflow({ failure: 'mv: Directory not empty' })
  try {
    await run(() => view.operations.cutRemoteSelection(sources))
    await run(() => view.operations.pasteRemoteEntries('/target'))
    assert.equal(view.requests.length, 1)
    assert.ok(view.operations.remoteClipboard)
    assert.equal(view.operations.activeOperation, null)
    assert.ok(view.notices.some(({ kind, message }) => kind === 'error' && message.includes('Directory not empty')))
    assert.ok(view.refreshed.includes('active') && view.refreshed.includes('source'))
  } finally { view.unmount() }
})

for (const strategy of ['force', 'skip', 'update'] as const) {
  test(`extraction ${strategy} waits only for missing destination and submits once`, async () => {
    const view = await mountWorkflow()
    const archive = { name: 'release.tar.gz', path: '/archives/release.tar.gz' }
    try {
      for (const target of ['current-directory', 'archive-directory'] as const) {
        await run(() => view.operations.extractRemoteArchive(archive, target, '/target', strategy))
        const request = view.requests.at(-1)!
        assert.equal(request.operation, 'extract')
        assert.equal(request.strategy, strategy)
        assert.equal(request.archivePath, archive.path)
        assert.equal(request.wrapInDirectory, target === 'archive-directory')
        assert.equal(request.targetDirectory, '/target')
      }
      await run(() => view.operations.extractRemoteArchive(archive, 'choose-directory', '/target', strategy))
      assert.equal(view.requests.length, 2)
      assert.equal(view.operations.archiveDestinationDialog?.strategy, strategy)
      await run(() => view.operations.setArchiveDestinationDialog(null))
      assert.equal(view.requests.length, 2)
      await run(() => view.operations.extractRemoteArchive(archive, 'choose-directory', '/target', strategy))
      await run(() => { view.operations.beginArchiveExtractionAt('/chosen'); view.operations.beginArchiveExtractionAt('/chosen') })
      assert.equal(view.requests.length, 3)
      assert.equal(view.requests[2].targetDirectory, '/chosen')
      assert.equal(view.requests[2].strategy, strategy)
      assert.equal(view.operations.archiveDestinationDialog, null)
      assert.equal(document.querySelector('[role="alertdialog"]'), null)
    } finally { view.unmount() }
  })
}

test('extraction errors are shown and do not prevent refreshing the destination', async () => {
  const view = await mountWorkflow({ failure: 'unzip: command not found' })
  try {
    await run(() => view.operations.extractRemoteArchive({ name: 'a.zip', path: '/a.zip' }, 'current-directory', '/target', 'force'))
    assert.ok(view.notices.some(({ kind, message }) => kind === 'error' && message.includes('unzip: command not found')))
    assert.ok(view.refreshed.includes('active') && view.refreshed.includes('nested'))
    assert.equal(view.operations.activeOperation, null)
  } finally { view.unmount() }
})

test('completed extraction shows the normal success message and refreshes the destination', async () => {
  const view = await mountWorkflow()
  try {
    await run(() => view.operations.extractRemoteArchive({ name: 'a.zip', path: '/a.zip' }, 'current-directory', '/target', 'force'))
    assert.deepEqual(view.notices, [{ kind: 'info', message: '解压已完成' }])
    assert.ok(view.refreshed.includes('active') && view.refreshed.includes('nested'))
    assert.equal(view.operations.activeOperation, null)
  } finally { view.unmount() }
})
