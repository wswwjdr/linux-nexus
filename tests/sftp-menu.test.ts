import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteEntry, SearchResultTarget } from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
import { resolveSftpContextMenu, type SftpContextMenuContext, type SftpMenuActionNode, type SftpMenuNode } from '../src/renderer/src/context-menu/sftp-menu.ts'

function entry(name: string, type: RemoteEntry['type'] = 'file'): RemoteEntry {
  return { name, path: '/home/user/' + name, type, size: 12, modifiedAt: null, permissions: 'rw-r--r--' }
}

function result(name: string): SearchResultTarget {
  return { name, path: '/home/user/' + name, type: 'file' }
}

function actions(nodes: SftpMenuNode[]): SftpMenuActionNode[] {
  return nodes.flatMap((node) => node.kind === 'action'
    ? [node]
    : node.kind === 'submenu' ? actions(node.children) : [])
}

test('single file composes preview, reverse-preview and script strategies before common actions', () => {
  const context: SftpContextMenuContext = { kind: 'single-entry', entry: entry('watch.sh'), canPaste: false }
  const nodes = resolveSftpContextMenu(context, defaultFileTypeExtensions())

  assert.deepEqual(nodes.map((node) => node.kind === 'separator' ? node.kind : node.id), [
    'preview', 'preview-log', 'script-execution', 'separator',
    'download', 'copy', 'cut', 'paste', 'copy-path', 'delete',
  ])
  const scriptMenu = nodes.find((node) => node.kind === 'submenu' && node.id === 'script-execution')
  assert.equal(scriptMenu?.kind, 'submenu')
  if (scriptMenu?.kind === 'submenu') assert.deepEqual(scriptMenu.children.map(({ label }) => label), ['执行', '调整并执行'])
  assert.equal(actions(nodes).find(({ id }) => id === 'paste')?.disabled, true)
})

test('Markdown combines text and Markdown preview modes and gets reverse-preview once', () => {
  const nodes = resolveSftpContextMenu(
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
  const exactMatch = resolveSftpContextMenu(
    { kind: 'single-entry', entry: entry('watch.job.min.sh'), canPaste: false },
    extensions,
  )
  assert.ok(exactMatch.some((node) => node.id === 'script-execution'))
  assert.equal(exactMatch.some((node) => node.id === 'preview'), false)
  const partialMatch = resolveSftpContextMenu(
    { kind: 'single-entry', entry: entry('watch.min.sh'), canPaste: false },
    extensions,
  )
  assert.equal(partialMatch.some((node) => node.id === 'script-execution'), false)
})

test('single unsupported entries expose only path copying', () => {
  for (const type of ['symlink', 'other'] as const) {
    const nodes = resolveSftpContextMenu(
      { kind: 'single-entry', entry: entry('link', type), canPaste: true },
      defaultFileTypeExtensions(),
    )
    assert.deepEqual(nodes.map(({ id }) => id), ['copy-path'])
  }
})

test('mixed selections never expose operations that would silently skip selected entries', () => {
  const nodes = resolveSftpContextMenu({
    kind: 'multiple-entries',
    entries: [entry('readme.md'), entry('link', 'symlink')],
    canPaste: false,
  }, defaultFileTypeExtensions())
  assert.deepEqual(nodes.map(({ id }) => id), ['paste'])
  assert.equal(actions(nodes)[0].disabled, true)
})

test('all-supported selections keep one batch menu and directory backgrounds use the same strategy model', () => {
  const batch = resolveSftpContextMenu({
    kind: 'multiple-entries',
    entries: [entry('a.txt'), entry('folder', 'directory')],
    canPaste: true,
  }, defaultFileTypeExtensions())
  assert.deepEqual(batch.map(({ id }) => id), ['download', 'copy', 'cut', 'paste', 'delete'])
  assert.equal(batch[0].kind === 'action' ? batch[0].label : '', '下载 2 项')

  const background = resolveSftpContextMenu({
    kind: 'directory-background',
    directory: '/home/user',
    canPaste: true,
    sort: { column: 'name', direction: 'ascending' },
  }, defaultFileTypeExtensions())
  assert.deepEqual(background.map(({ id }) => id), ['sort', 'copy-path', 'paste', 'create-directory', 'upload'])
  assert.equal(background[0].kind, 'submenu')
})

test('search results share all applicable type actions and keep location navigation', () => {
  const nodes = resolveSftpContextMenu({ kind: 'search-result', result: result('run.sh') }, defaultFileTypeExtensions())
  assert.deepEqual(nodes.map((node) => node.kind === 'separator' ? node.kind : node.id), [
    'preview', 'preview-log', 'script-execution', 'separator', 'open-location',
  ])
  const target = resolveSftpContextMenu({ kind: 'search-result', result: result('run.sh') }, defaultFileTypeExtensions())
  assert.equal(target.at(-1)?.kind === 'action' ? target.at(-1)?.label : '', '打开所在目录')
})
