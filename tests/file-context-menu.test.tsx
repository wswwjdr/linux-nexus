import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { RemoteEntry } from '../src/shared/types.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
import FileContextMenu from '../src/renderer/src/features/files/FileContextMenu.tsx'
import type { FileContextMenuContext, FileMenuAction } from '../src/renderer/src/features/files/file-menu.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  MouseEvent: { configurable: true, value: dom.window.MouseEvent },
  KeyboardEvent: { configurable: true, value: dom.window.KeyboardEvent },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
})

function entry(name: string): RemoteEntry {
  return { name, path: '/home/user/' + name, type: 'file', size: 12, modifiedAt: null, permissions: 'rw-r--r--' }
}

function mount(context: FileContextMenuContext) {
  const anchor = document.createElement('button')
  anchor.textContent = 'open menu'
  document.body.append(anchor)
  const anchorRef = createRef<HTMLElement>()
  anchorRef.current = anchor
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  const actions: FileMenuAction[] = []
  let closeCount = 0
  act(() => root.render(createElement(FileContextMenu, {
    context,
    fileTypeExtensions: defaultFileTypeExtensions(),
    position: { x: 440, y: 260 },
    anchorRef,
    onAction: (action) => actions.push(action),
    onClose: () => { closeCount += 1 },
  })))
  return {
    actions,
    anchor,
    closeCount: () => closeCount,
    host,
    root,
    unmount() {
      act(() => root.unmount())
      anchor.remove()
      host.remove()
    },
  }
}

function key(target: HTMLElement, value: string) {
  act(() => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })))
}

test('renders disabled commands accessibly and supports Home, End and arrow navigation', () => {
  const menu = mount({ kind: 'single-entry', entry: entry('plain.txt'), canPaste: false })
  const buttons = Array.from(menu.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
  assert.equal(document.activeElement, buttons[0])
  const pasteTrigger = menu.host.querySelector<HTMLButtonElement>('[data-submenu-trigger="paste-strategy"]')!
  assert.equal(pasteTrigger.disabled, true)
  assert.match(pasteTrigger.getAttribute('aria-label') ?? '', /剪贴板为空/)
  act(() => pasteTrigger.click())
  assert.equal(menu.host.querySelector('[data-submenu-panel="paste-strategy"]'), null)

  key(buttons[0], 'End')
  assert.equal(document.activeElement, buttons.at(-1))
  key(buttons.at(-1)!, 'Home')
  assert.equal(document.activeElement, buttons[0])
  key(buttons[0], 'ArrowDown')
  assert.equal(document.activeElement, buttons[1])
  key(buttons[1], 'ArrowUp')
  assert.equal(document.activeElement, buttons[0])
  menu.unmount()
})

test('paste submenu exposes only immediate force and skip actions', () => {
  const menu = mount({ kind: 'single-entry', entry: entry('plain.txt'), canPaste: true })
  try {
    const trigger = menu.host.querySelector<HTMLButtonElement>('[data-submenu-trigger="paste-strategy"]')!
    act(() => trigger.click())
    const items = Array.from(menu.host.querySelectorAll<HTMLButtonElement>('[data-submenu-panel="paste-strategy"] [role="menuitem"]'))
    assert.equal(items.length, 2)
    act(() => items[0].click())
    act(() => items[1].click())
    assert.deepEqual(menu.actions, [{ type: 'paste', strategy: 'force' }, { type: 'paste', strategy: 'skip' }])
  } finally { menu.unmount() }
})

test('opens and closes script submenu with arrows and returns focus to the invoking file on Escape', () => {
  const menu = mount({ kind: 'single-entry', entry: entry('run.sh'), canPaste: true })
  assert.equal(menu.host.querySelectorAll('[role="separator"]').length, 1)
  const trigger = menu.host.querySelector<HTMLButtonElement>('[data-submenu-trigger="script-execution"]')!
  act(() => trigger.focus())
  key(trigger, 'ArrowRight')
  const runAction = menu.host.querySelector<HTMLButtonElement>('[data-submenu-panel="script-execution"] [role="menuitem"]')!
  assert.equal(document.activeElement, runAction)

  key(runAction, 'Escape')
  assert.equal(document.activeElement, trigger)
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  key(trigger, 'Escape')
  assert.equal(menu.closeCount(), 1)
  assert.equal(document.activeElement, menu.anchor)
  menu.unmount()
})

test('opens a submenu on mouse hover and dispatches its action', () => {
  const menu = mount({ kind: 'single-entry', entry: entry('run.sh'), canPaste: true })
  const trigger = menu.host.querySelector<HTMLButtonElement>('[data-submenu-trigger="script-execution"]')!
  act(() => trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })))

  const runAction = menu.host.querySelector<HTMLButtonElement>('[data-submenu-panel="script-execution"] [role="menuitem"]')
  assert.ok(runAction)
  act(() => runAction!.click())
  assert.deepEqual(menu.actions, [{ type: 'run-script' }])
  menu.unmount()
})

test('dispatches semantic commands and closes when the pointer leaves the menu', () => {
  const menu = mount({ kind: 'single-entry', entry: entry('plain.txt'), canPaste: true })
  const download = Array.from(menu.host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
    .find((button) => button.textContent?.includes('下载文件'))!
  act(() => download.click())
  assert.deepEqual(menu.actions, [{ type: 'download' }])

  act(() => document.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true })))
  assert.equal(menu.closeCount(), 1)
  menu.unmount()
})

test('measures the real menu and flips a submenu to fit the viewport', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('browser-context-menu')) return { left: 0, top: 0, right: 204, bottom: 200, width: 204, height: 200, x: 0, y: 0, toJSON() {} }
    if (this.hasAttribute('data-submenu-panel')) return { left: 0, top: 0, right: 184, bottom: 120, width: 184, height: 120, x: 0, y: 0, toJSON() {} }
    if (this.hasAttribute('data-submenu-trigger')) return { left: 450, top: 260, right: 470, bottom: 284, width: 20, height: 24, x: 450, y: 260, toJSON() {} }
    return original.call(this)
  }
  const menu = mount({ kind: 'single-entry', entry: entry('README.md'), canPaste: true })
  const trigger = menu.host.querySelector<HTMLButtonElement>('[data-submenu-trigger="preview"]')!
  act(() => trigger.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })))
  const rootMenu = menu.host.querySelector<HTMLElement>('.browser-context-menu')!
  const panel = menu.host.querySelector<HTMLElement>('[data-submenu-panel="preview"]')!
  assert.equal(rootMenu.style.left, '288px')
  assert.equal(rootMenu.style.top, '92px')
  assert.equal(panel.style.left, '267px')
  assert.equal(panel.style.top, '164px')
  menu.unmount()
  HTMLElement.prototype.getBoundingClientRect = original
})
