import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import GlobalToast, { type ToastNotice } from '../src/renderer/src/GlobalToast.tsx'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})

test('progress stays visible without an expiry timer, supports cancellation, and survives another notice being dismissed', async () => {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const originalSetTimeout = window.setTimeout
  const originalClearTimeout = window.clearTimeout
  const timers = new Map<number, () => void>()
  let timerId = 0
  window.setTimeout = ((callback: () => void) => { timers.set(++timerId, callback); return timerId }) as typeof window.setTimeout
  window.clearTimeout = (id) => { timers.delete(id) }
  let cancellations = 0
  let dismissed: number | null = null
  const progress = { message: '正在复制…', onCancel: () => { cancellations++ } }
  const render = async (notice: ToastNotice | null, running = true) => {
    await act(async () => root.render(createElement(GlobalToast, {
      notice, progress: running ? progress : null, onDismiss: (id) => { dismissed = id },
    })))
  }
  try {
    await render(null)
    assert.equal(timers.size, 0)
    assert.ok(host.querySelector('.global-toast-stack [role="status"]')?.textContent?.includes('正在复制…'))
    act(() => host.querySelector<HTMLButtonElement>('button')!.click())
    assert.equal(cancellations, 1)

    await render({ id: 1, kind: 'error', message: '取消操作失败' })
    assert.equal(host.querySelectorAll('.global-toast').length, 2)
    assert.ok(host.querySelector('[role="alert"]')?.textContent?.includes('取消操作失败'))
    assert.equal(timers.size, 1)
    act(() => [...timers.values()][0]())
    assert.equal(dismissed, 1)
    await render(null)
    assert.equal(timers.size, 0)
    assert.ok(host.textContent?.includes('正在复制…'))

    await render({ id: 2, kind: 'info', message: '复制已完成' }, false)
    assert.ok(!host.textContent?.includes('正在复制'))
    assert.ok(host.textContent?.includes('复制已完成'))
    assert.equal(host.querySelectorAll('.global-toast').length, 1)
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')!.click())
    assert.equal(dismissed, 2)
  } finally {
    act(() => root.unmount())
    host.remove()
    window.setTimeout = originalSetTimeout
    window.clearTimeout = originalClearTimeout
  }
})
