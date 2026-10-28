import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ComponentType } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { RemoteArchiveDecision, RemoteArchiveEvent, RemoteFilesApi, RemoteEntry, RemoteMoveConflict, RemoteMoveDecision } from '../src/shared/types.ts'
import type { RemoteArchiveDialogsProps } from '../src/renderer/src/components/RemoteArchiveDialogs.tsx'
import { RemoteMoveConflictDialog } from '../src/renderer/src/components/RemoteMoveDialogs.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  Event: { configurable: true, value: dom.window.Event },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
})

function directory(name: string, path: string): RemoteEntry {
  return { name, path, type: 'directory', size: 0, modifiedAt: null, permissions: 'rwxr-xr-x' }
}

async function mount<P extends object>(Component: ComponentType<P>, props: P) {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  await act(async () => {
    root.render(createElement(Component, props))
    await Promise.resolve()
  })
  return {
    host,
    root,
    unmount() {
      act(() => root.unmount())
      host.remove()
    },
  }
}

async function settleUi() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
}

async function clickAndSettle(button: HTMLButtonElement) {
  await act(async () => {
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

test('remote directory picker browses, creates and selects a destination without changing the current browser path', async () => {
  const { RemoteArchiveDialogs } = await import('../src/renderer/src/components/RemoteArchiveDialogs.tsx')
  const listed: string[] = []
  const created: Array<{ directory: string; name: string }> = []
  const selected: string[] = []
  const entries: Record<string, RemoteEntry[]> = {
    '/home/user': [directory('projects', '/home/user/projects')],
    '/home/user/projects': [],
  }
  const api = {
    listDirectory: async (_sessionId: string, path: string) => {
      listed.push(path)
      return entries[path] ?? []
    },
  } as RemoteFilesApi
  Object.defineProperty(window, 'remoteFiles', { configurable: true, value: api })
  const view = await mount(RemoteArchiveDialogs, {
    destination: { sessionId: 'session', entry: { name: 'release.tar.gz', path: '/home/user/release.tar.gz' }, directory: '/home/user' },
    extraction: null,
    summary: null,
    onCloseDestination: () => {},
    onChooseDestination: (path) => selected.push(path),
    onCreateDirectory: async (path, name) => { created.push({ directory: path, name }) },
    onConflictDecision: () => {},
    onCloseSummary: () => {},
  })

  try {
    await settleUi()
    const projects = Array.from(document.querySelectorAll<HTMLButtonElement>('.remote-directory-entry'))
      .find((button) => button.textContent?.includes('projects'))!
    await clickAndSettle(projects)

    const nameInput = document.querySelector<HTMLInputElement>('[aria-label="新文件夹名称"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(nameInput, 'output')
      nameInput.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'output' }))
    })
    const form = nameInput.closest('form')!
    await act(async () => {
      form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const output = Array.from(document.querySelectorAll<HTMLButtonElement>('.remote-directory-entry'))
      .find((button) => button.textContent?.includes('output'))
    assert.ok(output)
    await clickAndSettle(output)
    await clickAndSettle(document.querySelector<HTMLButtonElement>('.remote-directory-picker .primary-button')!)

    assert.deepEqual(created, [{ directory: '/home/user/projects', name: 'output' }])
    assert.deepEqual(selected, ['/home/user/projects/output'])
    assert.deepEqual(listed, ['/home/user', '/home/user/projects', '/home/user/projects/output'])
  } finally {
    view.unmount()
  }
})

test('archive file conflicts use a default overwrite choice and apply the selected action to this extraction', async () => {
  const { RemoteArchiveDialogs } = await import('../src/renderer/src/components/RemoteArchiveDialogs.tsx')
  const decisions: RemoteArchiveDecision[] = []
  const conflict: RemoteArchiveEvent = {
    type: 'conflict',
    conflict: {
      requestId: 'archive-task',
      conflictId: 'conflict-file',
      sessionId: 'session',
      archivePath: '/home/release.zip',
      memberPath: 'readme.txt',
      targetPath: '/home/readme.txt',
      sourceType: 'file',
      targetType: 'file',
      conflictType: 'file',
    },
  }
  const extraction = {
    requestId: 'archive-task',
    sessionId: 'session',
    name: 'release.zip',
    path: '/home/release.zip',
    targetDirectory: '/home',
    wrapInDirectory: false,
    progress: { requestId: 'archive-task', sessionId: 'session', phase: 'merging' as const, completedCount: 1, totalCount: 3, currentPath: 'readme.txt' },
    conflict: conflict.conflict,
    decisionPending: false,
  }
  const view = await mount(RemoteArchiveDialogs, {
    destination: null,
    extraction,
    summary: null,
    onCloseDestination: () => {},
    onChooseDestination: () => {},
    onCreateDirectory: async () => {},
    onConflictDecision: (decision) => decisions.push(decision),
    onCloseSummary: () => {},
  })

  try {
    const choices = Array.from(document.querySelectorAll<HTMLInputElement>('.remote-conflict-choice input[type="radio"]'))
    assert.equal(choices.length, 3)
    assert.equal(choices.find((input) => input.value === 'replace')?.checked, true)
    const applyToAll = document.querySelector<HTMLInputElement>('.remote-conflict-apply-all input')!
    assert.equal(applyToAll.checked, false)
    await clickAndSettle(choices.find((input) => input.value === 'skip')!)
    await clickAndSettle(applyToAll)
    await clickAndSettle(document.querySelector<HTMLButtonElement>('.remote-conflict-choice-footer .primary-button')!)
    assert.deepEqual(decisions, ['skip-all'])

    await clickAndSettle(choices.find((input) => input.value === 'rename')!)
    await clickAndSettle(applyToAll)
    await clickAndSettle(document.querySelector<HTMLButtonElement>('.remote-conflict-choice-footer .primary-button')!)
    assert.deepEqual(decisions, ['skip-all', 'rename'])

    const typeConflict = {
      ...extraction,
      conflict: { ...conflict.conflict, conflictId: 'conflict-type', sourceType: 'directory' as const, targetType: 'file' as const, conflictType: 'type-mismatch' as const },
    }
    act(() => view.root.render(createElement(RemoteArchiveDialogs, {
      destination: null,
      extraction: typeConflict,
      summary: null,
      onCloseDestination: () => {},
      onChooseDestination: () => {},
      onCreateDirectory: async () => {},
      onConflictDecision: (decision: RemoteArchiveDecision) => decisions.push(decision),
      onCloseSummary: () => {},
    })))
    assert.equal(document.querySelector('.remote-conflict-choice-form'), null)
    assert.equal(Array.from(document.querySelectorAll<HTMLButtonElement>('.remote-move-conflict-actions button'))
      .some((button) => button.textContent?.includes('后续全部')), false)
    assert.ok(document.body.textContent?.includes('保留双方并重命名'))
  } finally {
    view.unmount()
  }
})

test('copy and move conflicts use batch radio choices while type mismatches stay individual', async () => {
  const decisions: RemoteMoveDecision[] = []
  const conflict: RemoteMoveConflict = {
    requestId: 'move-task',
    conflictId: 'move-file-conflict',
    sessionId: 'session',
    sourcePath: '/home/source.txt',
    targetPath: '/home/target/source.txt',
    sourceName: 'source.txt',
    targetName: 'source.txt',
    sourceType: 'file',
    targetType: 'file',
    conflictType: 'file',
  }
  const view = await mount(RemoteMoveConflictDialog, {
    conflict,
    busy: false,
    operation: 'copy',
    onDecision: (decision) => decisions.push(decision),
  })

  try {
    const choices = Array.from(document.querySelectorAll<HTMLInputElement>('.remote-conflict-choice input[type="radio"]'))
    assert.equal(choices.length, 3)
    assert.equal(choices.find((input) => input.value === 'replace')?.checked, true)
    assert.ok(document.body.textContent?.includes('覆盖会替换目标文件内容'))
    assert.ok(document.body.textContent?.includes('包括文件夹内部的文件'))
    assert.ok(document.body.textContent?.includes('名称 (2).扩展名'))
    const applyToAll = document.querySelector<HTMLInputElement>('.remote-conflict-apply-all input')!
    assert.equal(applyToAll.checked, false)
    await clickAndSettle(choices.find((input) => input.value === 'rename')!)
    await clickAndSettle(applyToAll)
    await clickAndSettle(document.querySelector<HTMLButtonElement>('.remote-conflict-choice-footer .primary-button')!)
    assert.deepEqual(decisions, ['rename-all'])

    const typeConflict = { ...conflict, conflictId: 'move-type-conflict', sourceType: 'directory' as const, targetType: 'file' as const, conflictType: 'type-mismatch' as const }
    view.unmount()
    const mismatchView = await mount(RemoteMoveConflictDialog, {
      conflict: typeConflict,
      busy: false,
      operation: 'move',
      onDecision: (decision) => decisions.push(decision),
    })
    try {
      const mismatchChoices = Array.from(document.querySelectorAll<HTMLInputElement>('.remote-conflict-choice input[type="radio"]'))
      assert.equal(mismatchChoices.length, 2)
      assert.equal(mismatchChoices.find((input) => input.value === 'rename')?.checked, true)
      assert.ok(document.body.textContent?.includes('自动重命名来源项'))
      assert.ok(document.body.textContent?.includes('文件夹名 (2)'))
      assert.ok(document.body.textContent?.includes('移动会保留现有目标'))
      assert.equal(document.querySelector('.remote-conflict-apply-all'), null)
      assert.equal(Array.from(document.querySelectorAll<HTMLButtonElement>('.remote-conflict-choice-footer button'))
        .some((button) => button.textContent?.includes('替换')), false)
      await clickAndSettle(document.querySelector<HTMLButtonElement>('.remote-conflict-choice-footer .primary-button')!)
      assert.deepEqual(decisions, ['rename-all', 'rename'])
    } finally {
      mismatchView.unmount()
    }
  } finally {
    if (document.body.querySelector('.remote-move-conflict')) view.unmount()
  }
})
