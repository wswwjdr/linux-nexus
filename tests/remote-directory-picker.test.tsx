import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ComponentType } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { RemoteFilesApi, RemoteEntry } from '../src/shared/types.ts'

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

test('remote directory picker browses, creates and selects a destination without changing the file browser path', async () => {
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
    onChooseDestination: (path: string) => selected.push(path),
    onCreateDirectory: async (path: string, name: string) => { created.push({ directory: path, name }) },
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
