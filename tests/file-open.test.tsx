import { renderMessage, type MessageValue } from '../src/shared/i18n/messages'
import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, Fragment, useState } from 'react'
import { JSDOM } from 'jsdom'
import type { FileTypeExtensions, PreviewResult, RemoteEntry, RemoteFilesApi } from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
import FileBrowser from '../src/renderer/src/features/files/FileBrowser.tsx'
import FileSessionWorkspace, { type SessionFileWorkspaceActions } from '../src/renderer/src/features/files/FileSessionWorkspace.tsx'
import type { SessionTab } from '../src/renderer/src/app-types.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
})
const noop = () => {}
function entry(name: string, type: RemoteEntry['type'] = 'file'): RemoteEntry {
  return { name, path: '/srv/' + name, type, size: 12, modifiedAt: null, permissions: 'rw-r--r--' }
}
const entries = [entry('notes.txt'), entry('README.md'), entry('unknown.bin'), entry('folder', 'directory'), entry('link', 'symlink'), entry('socket', 'other'), entry('run.sh'), entry('archive.zip')]
function session(id: string): SessionTab {
  return { id, profileId: 'profile', kind: 'files', status: 'connected', currentPath: '/srv', startPath: '/', entries,
    selectedPaths: [], loading: false, viewMode: 'details', sort: { column: 'name', direction: 'ascending' }, highlightedPath: null,
    history: ['/srv'], historyIndex: 0, error: null }
}
function mouse(target: Element, type: string, options: MouseEventInit = {}) {
  act(() => target.dispatchEvent(new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...options })))
}
function key(target: Element | Window, value: string, shiftKey = false) {
  act(() => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true })))
}
async function mount(viewMode: 'details' | 'icons' = 'details') {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const calls: Array<{ sessionId: string; path: string; type: string }> = []
  const notices: string[] = []
  const navigated: string[] = []
  const contexts: RemoteEntry[][] = []
  const actions = new Map<string, SessionFileWorkspaceActions>()
  const blocking = new Set<string>()
  const opened = new Set<string>()
  const sessions = [session('first'), session('second')]
  let current = 'first'
  let extensions = defaultFileTypeExtensions()
  window.remoteFiles = {
    previewFile: async (sessionId: string, path: string, type: string): Promise<PreviewResult> => {
      calls.push({ sessionId, path, type })
      if (path.endsWith('failure.txt')) throw new Error('read failed')
      return { type: 'text', name: path.split('/').pop()!, content: 'contents', lineEnding: '\n', encoding: 'utf8', bom: false,
        version: { hash: 'a'.repeat(64), identity: 'fixture' } }
    },
    releasePreview: async () => {},
  } as unknown as RemoteFilesApi
  const register = (id: string, value: SessionFileWorkspaceActions | null) => { if (value) actions.set(id, value); else actions.delete(id) }
  const showToast = (_kind: string, message: MessageValue) => { notices.push(renderMessage(message)) }
  function Browser() {
    const [selectedPaths, setSelectedPaths] = useState<string[]>([])
    return createElement(FileBrowser, {
      currentPath: '/srv', entries, loading: false, viewMode, breadcrumbs: [], sort: sessions[0].sort, sortedEntries: entries,
      selectedPaths, operationActive: false, highlightedPath: null,
      onViewModeChange: noop, onNavigate: async (path) => { navigated.push(path); return true },
      onOpenFile: (file) => actions.get(current)!.openFile(file), onToggleSort: noop, onSelectedPathsChange: setSelectedPaths,
      onOpenEntryContextMenu: (targets) => { contexts.push(targets) }, onOpenDirectoryContextMenu: noop,
      onDeleteEntries: noop, onDropUpload: noop, onDropMove: noop, onDropError: noop,
    })
  }
  const render = (active = current, config: FileTypeExtensions = extensions) => {
    current = active
    extensions = config
    act(() => root.render(createElement(Fragment, null, createElement(Browser), ...sessions.map((value) => createElement(FileSessionWorkspace, {
      key: value.id, session: { ...value }, active: value.id === current, searchOpen: false, propertiesOpen: false,
      scriptCommandDialog: null, scriptExecutionDialog: null, fileTypeExtensions: extensions, showToast,
      onSearchOpenChange: noop,
      onWorkspaceOpenChange: (id, open) => { if (open) opened.add(id); else opened.delete(id) },
      onBlockingChange: (id, block) => { if (block) blocking.add(id); else blocking.delete(id) },
      onRegisterWorkspaceActions: register, onCloseScriptCommand: noop, onUpdateScriptCommand: noop, onSubmitScriptCommand: noop,
      onCloseScriptExecution: noop, onStopScriptExecution: noop, onMenuAction: noop, onOpenExternalLink: noop,
    })))))
  }
  render()
  const row = (name: string) => host.querySelector<HTMLElement>('[data-entry-path="/srv/' + name + '"]')!
  const flush = async () => { await act(async () => { await Promise.resolve() }) }
  const doubleClick = async (target: Element) => {
    mouse(target, 'click', { detail: 1 })
    mouse(target, 'click', { detail: 2 })
    mouse(target, 'dblclick', { detail: 2 })
    await flush()
  }
  return { host, calls, notices, navigated, contexts, actions, blocking, opened, sessions, render, row, flush, doubleClick,
    unmount() { act(() => root.unmount()); host.remove() } }
}

for (const view of ['details', 'icons'] as const) {
  test(view + ': double-click opens each surface once, directories navigate and special entries stay unchanged', async () => {
    const fixture = await mount(view)
    try {
      const selectors = view === 'details' ? ['.entry-label', '.entry-icon svg', '.size-col', null] : ['.tile-name', '.tile-glyph svg', '.file-tile-main', null]
      for (const selector of selectors) {
        const row = fixture.row('notes.txt')
        await fixture.doubleClick(selector ? row.querySelector(selector)! : row)
        assert.equal(fixture.calls.length, 1)
        assert.deepEqual(fixture.calls[0], { sessionId: 'first', path: '/srv/notes.txt', type: 'text' })
        key(window, 'Escape')
        fixture.calls.length = 0
      }
      await fixture.doubleClick(fixture.row('folder'))
      assert.deepEqual(fixture.navigated, ['/srv/folder'])
      for (const name of ['link', 'socket']) await fixture.doubleClick(fixture.row(name))
      assert.equal(fixture.calls.length, 0)
      assert.equal(fixture.notices.length, 0)
      for (const name of ['unknown.bin', 'archive.zip']) await fixture.doubleClick(fixture.row(name))
      assert.equal(fixture.notices.length, 2)
      assert.match(fixture.notices[0], /暂不支持的文件类型/)
      await fixture.doubleClick(fixture.row('run.sh'))
      assert.deepEqual(fixture.calls[0], { sessionId: 'first', path: '/srv/run.sh', type: 'text' })
    } finally { fixture.unmount() }
  })
}

test('multiple previews require a choice; keyboard, cancellation and focus restoration work', async () => {
  const fixture = await mount()
  try {
    const anchor = fixture.row('README.md').querySelector<HTMLButtonElement>('button')!
    anchor.focus()
    await fixture.doubleClick(anchor)
    assert.equal(fixture.calls.length, 0)
    assert.equal(fixture.blocking.has('first'), true)
    assert.equal(fixture.opened.has('first'), true)
    const dialog = fixture.host.querySelector<HTMLElement>('.file-open-dialog')!
    assert.match(dialog.textContent!, /README.md/)
    const options = Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-preview-type]'))
    assert.deepEqual(options.map((button) => button.textContent), ['文本预览', 'Markdown 预览'])
    assert.equal(document.activeElement, options[0])
    key(options[0], 'ArrowDown')
    assert.equal(document.activeElement, options[1])
    key(options[1], 'ArrowUp')
    assert.equal(document.activeElement, options[0])
    const close = dialog.querySelector<HTMLButtonElement>('[aria-label="关闭"]')!
    close.focus()
    key(close, 'Tab', true)
    assert.equal(document.activeElement?.textContent, '取消')
    key(document.activeElement!, 'Tab')
    assert.equal(document.activeElement, close)
    key(window, 'Escape')
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    assert.equal(document.activeElement, anchor)
    assert.equal(fixture.blocking.size, 0)
    assert.equal(fixture.opened.size, 0)
    for (const selector of ['[aria-label="关闭"]', '.modal-footer button', '.file-open-backdrop']) {
      await fixture.doubleClick(anchor)
      mouse(fixture.host.querySelector(selector)!, selector === '.file-open-backdrop' ? 'mousedown' : 'click')
      assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    }
    assert.equal(fixture.calls.length, 0)
    await fixture.doubleClick(anchor)
    mouse(fixture.host.querySelector('[data-preview-type="markdown"]')!, 'click')
    await fixture.flush()
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    assert.deepEqual(fixture.calls, [{ sessionId: 'first', path: '/srv/README.md', type: 'markdown' }])
  } finally { fixture.unmount() }
})

test('preview choice belongs to its session and disconnect clears it', async () => {
  const fixture = await mount()
  try {
    await fixture.doubleClick(fixture.row('README.md'))
    fixture.render('second')
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    assert.equal(fixture.blocking.size, 0)
    await fixture.doubleClick(fixture.row('notes.txt'))
    assert.equal(fixture.calls[0].sessionId, 'second')
    key(window, 'Escape')
    fixture.render('first')
    assert.ok(fixture.host.querySelector('.file-open-dialog'))
    mouse(fixture.host.querySelector('[data-preview-type="text"]')!, 'click')
    await fixture.flush()
    assert.equal(fixture.calls[1].sessionId, 'first')
    key(window, 'Escape')
    await fixture.doubleClick(fixture.row('README.md'))
    fixture.sessions[0].status = 'disconnected'
    fixture.render()
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    assert.equal(fixture.blocking.size, 0)
    fixture.sessions[0].status = 'connected'
    fixture.render()
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
  } finally { fixture.unmount() }
})

test('opening uses updated file type settings and preserves preview error feedback', async () => {
  const fixture = await mount()
  try {
    const extensions = defaultFileTypeExtensions()
    extensions.markdown = []
    fixture.render('first', extensions)
    await fixture.doubleClick(fixture.row('README.md'))
    assert.equal(fixture.host.querySelector('.file-open-dialog'), null)
    assert.equal(fixture.calls[0].type, 'text')
    key(window, 'Escape')
    extensions.text = ['bin', 'txt']
    fixture.render('first', { ...extensions })
    await fixture.doubleClick(fixture.row('unknown.bin'))
    assert.equal(fixture.calls[1].type, 'text')
    key(window, 'Escape')
    act(() => fixture.actions.get('first')!.openFile(entry('failure.txt')))
    await fixture.flush()
    assert.match(fixture.notices[0], /预览失败：read failed/)
  } finally { fixture.unmount() }
})

test('single click, additive selection, context menu and drag retain their behavior', async () => {
  const fixture = await mount()
  try {
    mouse(fixture.row('notes.txt'), 'click')
    mouse(fixture.row('README.md'), 'click', { ctrlKey: true })
    assert.equal(fixture.host.querySelectorAll('[aria-selected="true"]').length, 2)
    assert.equal(fixture.calls.length, 0)
    mouse(fixture.row('README.md'), 'contextmenu')
    assert.deepEqual(fixture.contexts[0].map(({ name }) => name), ['notes.txt', 'README.md'])
    const data = new Map<string, string>()
    const drag = new dom.window.Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(drag, 'dataTransfer', { value: { setData: (type: string, value: string) => data.set(type, value), effectAllowed: '' } })
    act(() => fixture.row('notes.txt').dispatchEvent(drag))
    assert.deepEqual(JSON.parse(data.get('application/x-linux-nexus-remote-files')!), ['/srv/notes.txt', '/srv/README.md'])
    assert.equal(fixture.calls.length, 0)
  } finally { fixture.unmount() }
})
