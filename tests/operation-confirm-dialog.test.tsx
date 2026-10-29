import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import type { Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { OperationExecutionStrategy, RemoteOperationConfirmation } from '../src/shared/types.ts'

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

test('shows the selected operation and command before execution', async () => {
  const { default: OperationConfirmDialog } = await import('../src/renderer/src/components/OperationConfirmDialog.tsx')
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const selected: OperationExecutionStrategy[] = []
  const confirmation: RemoteOperationConfirmation = {
    requestId: 'request-1',
    sessionId: 'session',
    operation: 'copy',
    sourcePaths: ['/home/source'],
    targetDirectory: '/home/target',
    strategy: 'confirm',
    commandPreviews: {
      force: 'cp -f -- /home/source /home/target',
      skip: 'cp -n -- /home/source /home/target',
      update: 'cp -u -- /home/source /home/target',
    },
  }

  try {
    await act(async () => {
      root.render(createElement(OperationConfirmDialog, {
        confirmation,
        busy: false,
        onConfirm: (strategy: OperationExecutionStrategy) => selected.push(strategy),
        onCancel: () => {},
      }))
      await Promise.resolve()
    })
    assert.ok(document.body.textContent?.includes('/home/target'))
    assert.ok(document.body.textContent?.includes('cp -f -- /home/source /home/target'))
    await act(async () => {
      document.querySelector<HTMLButtonElement>('.operation-confirm-dialog .primary-button')!.click()
      await Promise.resolve()
    })
    assert.deepEqual(selected, ['force'])
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
