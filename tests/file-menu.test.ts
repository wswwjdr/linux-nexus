import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteEntry, SearchResultTarget } from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
import { resolveFileContextMenu, type FileContextMenuContext, type FileMenuActionNode, type FileMenuNode } from '../src/renderer/src/features/files/file-menu.ts'
import { useFileMenuActions } from '../src/renderer/src/features/files/useFileMenuActions.ts'

function entry(name: string, type: RemoteEntry['type'] = 'file'): RemoteEntry {
  return { name, path: '/home/user/' + name, type, size: 12, modifiedAt: null, permissions: 'rw-r--r--' }
}

function result(name: string): SearchResultTarget {
  return { name, path: '/home/user/' + name, type: 'file' }
}

function actions(nodes: FileMenuNode[]): FileMenuActionNode[] {
  return nodes.flatMap((node) => node.kind === 'action'
    ? [node]
    : node.kind === 'submenu' ? actions(node.children) : [])
}

test('single file composes preview, reverse-preview and script strategies before common actions', () => {
  const context: FileContextMenuContext = { kind: 'single-entry', entry: entry('watch.sh'), canPaste: false }
  const nodes = resolveFileContextMenu(context, defaultFileTypeExtensions())

  assert.deepEqual(nodes.map((node) => node.kind === 'separator' ? node.kind : node.id), [
    'preview', 'preview-log', 'script-execution', 'separator',
    'download', 'copy', 'cut', 'paste-strategy', 'copy-path', 'delete',
  ])
  const scriptMenu = nodes.find((node) => node.kind === 'submenu' && node.id === 'script-execution')
  assert.equal(scriptMenu?.kind, 'submenu')
  if (scriptMenu?.kind === 'submenu') assert.deepEqual(scriptMenu.children.map(({ label }) => label), ['执行', '调整并执行'])
  const pasteMenu = nodes.find((node) => node.kind === 'submenu' && node.id === 'paste-strategy')
  assert.equal(pasteMenu?.kind, 'submenu')
  if (pasteMenu?.kind === 'submenu') assert.equal(pasteMenu.children.every((node) => node.kind === 'action' && node.disabled), true)
})

test('Markdown combines text and Markdown preview modes and gets reverse-preview once', () => {
  const nodes = resolveFileContextMenu(
    { kind: 'single-entry', entry: entry('README.md'), canPaste: true },
    defaultFileTypeExtensions(),
  )
  assert.deepEqual(nodes.slice(0, 2).map((node) => node.id), ['preview', 'preview-log'])
  const previewMenu = nodes[0]
  assert.equal(previewMenu.kind, 'submenu')
  if (previewMenu.kind === 'submenu') assert.deepEqual(previewMenu.children.map(({ label }) => label), ['文本预览', 'Markdown 预览'])
})

test('file suffix settings immediately control menu capabilities and exact multi-part matches', () => {
  const extensions = defaultFileTypeExtensions()
  extensions.text = []
  extensions.script = ['job.min.sh']
  const exactMatch = resolveFileContextMenu(
    { kind: 'single-entry', entry: entry('watch.job.min.sh'), canPaste: false },
    extensions,
  )
  assert.ok(exactMatch.some((node) => node.id === 'script-execution'))
  assert.equal(exactMatch.some((node) => node.id === 'preview'), false)
  const partialMatch = resolveFileContextMenu(
    { kind: 'single-entry', entry: entry('watch.min.sh'), canPaste: false },
    extensions,
  )
  assert.equal(partialMatch.some((node) => node.id === 'script-execution'), false)
})

test('single unsupported entries expose only path copying', () => {
  for (const type of ['symlink', 'other'] as const) {
    const nodes = resolveFileContextMenu(
      { kind: 'single-entry', entry: entry('link', type), canPaste: true },
      defaultFileTypeExtensions(),
    )
    assert.deepEqual(nodes.map(({ id }) => id), ['copy-path'])
  }
})

test('mixed selections never expose operations that would silently skip selected entries', () => {
  const nodes = resolveFileContextMenu({
    kind: 'multiple-entries',
    entries: [entry('readme.md'), entry('link', 'symlink')],
    canPaste: false,
  }, defaultFileTypeExtensions())
  assert.deepEqual(nodes.map(({ id }) => id), ['paste-strategy'])
  assert.equal(nodes[0].kind === 'submenu' && nodes[0].children.every((node) => node.kind === 'action' && node.disabled), true)
})

test('all-supported selections keep one batch menu and directory backgrounds use the same strategy model', () => {
  const batch = resolveFileContextMenu({
    kind: 'multiple-entries',
    entries: [entry('a.txt'), entry('folder', 'directory')],
    canPaste: true,
  }, defaultFileTypeExtensions())
  assert.deepEqual(batch.map(({ id }) => id), ['download', 'copy', 'cut', 'paste-strategy', 'delete'])
  assert.equal(batch[0].kind === 'action' ? batch[0].label : '', '下载 2 项')

  const background = resolveFileContextMenu({
    kind: 'directory-background',
    directory: '/home/user',
    canPaste: true,
    sort: { column: 'name', direction: 'ascending' },
  }, defaultFileTypeExtensions())
  assert.deepEqual(background.map(({ id }) => id), ['sort', 'copy-path', 'paste-strategy', 'create-directory', 'upload-strategy'])
  assert.equal(background[0].kind, 'submenu')
})

test('search results share all applicable type actions and keep location navigation', () => {
  const nodes = resolveFileContextMenu({ kind: 'search-result', result: result('run.sh') }, defaultFileTypeExtensions())
  assert.deepEqual(nodes.map((node) => node.kind === 'separator' ? node.kind : node.id), [
    'preview', 'preview-log', 'script-execution', 'separator', 'open-location',
  ])
  const target = resolveFileContextMenu({ kind: 'search-result', result: result('run.sh') }, defaultFileTypeExtensions())
  assert.equal(target.at(-1)?.kind === 'action' ? target.at(-1)?.label : '', '打开所在目录')
})

test('supported archive files expose extraction while ordinary compressed streams do not', () => {
  const archiveNodes = resolveFileContextMenu(
    { kind: 'single-entry', entry: entry('release.tar.gz'), canPaste: false },
    defaultFileTypeExtensions(),
  )
  const archiveMenu = archiveNodes.find((node) => node.kind === 'submenu' && node.id === 'extract-archive')
  assert.equal(archiveMenu?.kind, 'submenu')
  if (archiveMenu?.kind === 'submenu') {
    const labels = archiveMenu.children.filter((node) => node.kind === 'action').map(({ label }) => label)
    assert.equal(archiveMenu.children.filter((node) => node.kind === 'separator').length, 2)
    assert.ok(labels.includes('release/ · 强制覆盖 (-f)'))
    assert.equal(labels.length, 12)
    assert.ok(labels.includes('选择目录 · 确认后处理'))
    assert.deepEqual(actions(archiveMenu.children).map(({ action }) => action), [
      ...(['current-directory', 'archive-directory', 'choose-directory'] as const).flatMap((target) =>
        (['force', 'skip', 'update', 'confirm'] as const).map((strategy) => ({
          type: 'extract-archive' as const, target, strategy,
        }))),
    ])
  }
  const searchArchiveMenu = resolveFileContextMenu(
    { kind: 'search-result', result: result('release.tar.gz') },
    defaultFileTypeExtensions(),
  ).find((node) => node.kind === 'submenu' && node.id === 'extract-archive')
  assert.equal(searchArchiveMenu?.kind, 'submenu')
  if (searchArchiveMenu?.kind === 'submenu') {
    assert.equal(actions(searchArchiveMenu.children).length, 12)
  }

  const unsupportedNodes = resolveFileContextMenu(
    { kind: 'single-entry', entry: entry('release.rar'), canPaste: false },
    defaultFileTypeExtensions(),
  )
  assert.equal(actions(unsupportedNodes).some(({ id }) => id === 'extract-archive'), false)
})

test('archive actions from search results always use the active browser directory', () => {
  const calls: unknown[][] = []
  const { dispatchFileMenuAction } = useFileMenuActions({
    activeSession: null,
    connectedSessionId: 'active-session',
    currentPath: '/active/browser/path',
    sort: { column: 'name', direction: 'asc' },
    canPasteRemote: false,
    setBrowserContextMenu: () => {},
    setSessionContextMenu: () => {},
    contextMenuAnchorRef: { current: null },
    setSearchOpen: () => {},
    previewActionsRef: { current: new Map() },
    scriptExecution: { runScript: () => {}, requestScriptCommandEdit: () => {} },
    transfers: { download: () => {}, uploadFiles: async () => {} },
    remoteOperations: {
      copyRemoteSelection: () => {},
      cutRemoteSelection: () => {},
      pasteRemoteEntries: () => {},
      requestRemoteEntriesDeletion: () => {},
      setCreateDirectoryDialog: () => {},
      extractRemoteArchive: (...args) => calls.push(args),
    },
    locateSearchResult: async () => true,
    patchSession: () => {},
    showToast: () => {},
  })
  const searchContext: FileContextMenuContext = {
    kind: 'search-result',
    result: { name: 'release.tar.gz', path: '/search/result/release.tar.gz', type: 'file' },
  }

  for (const target of ['current-directory', 'archive-directory', 'choose-directory'] as const) {
    dispatchFileMenuAction({ type: 'extract-archive', target, strategy: 'update' }, searchContext, 'active-session')
  }

  assert.deepEqual(calls.map(([, target, activeDirectory, strategy]) => [target, activeDirectory, strategy]), [
    ['current-directory', '/active/browser/path', 'update'],
    ['archive-directory', '/active/browser/path', 'update'],
    ['choose-directory', '/active/browser/path', 'update'],
  ])
})
