import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ComponentProps } from 'react'
import { JSDOM } from 'jsdom'
import GlobalToast from '../src/renderer/src/GlobalToast.tsx'
import { useToasts } from '../src/renderer/src/hooks/useToasts.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})

async function mountToasts() {
  const { createRoot } = await import('react-dom/client')
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const originalSetTimeout = window.setTimeout
  const originalClearTimeout = window.clearTimeout
  const timers = new Map<number, { at: number; callback: () => void }>()
  let now = 0
  let timerId = 0
  window.setTimeout = ((callback: () => void, delay: number) => {
    timers.set(++timerId, { at: now + delay, callback })
    return timerId
  }) as typeof window.setTimeout
  window.clearTimeout = (id) => { timers.delete(id) }
  let toasts!: ReturnType<typeof useToasts>
  let progress: ComponentProps<typeof GlobalToast>['progress'] = null
  function Harness() {
    toasts = useToasts()
    return createElement(GlobalToast, { notices: toasts.notices, onDismiss: toasts.dismissToast, progress })
  }
  await act(async () => root.render(createElement(Harness)))

  return {
    host,
    timers,
    get toasts() { return toasts },
    async setProgress(next: typeof progress) {
      progress = next
      await act(async () => root.render(createElement(Harness)))
    },
    async advance(milliseconds: number) {
      const end = now + milliseconds
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
        if (!next || next[1].at > end) break
        now = next[1].at
        timers.delete(next[0])
        await act(async () => next[1].callback())
      }
      now = end
    },
    unmount() {
      act(() => root.unmount())
      host.remove()
      window.setTimeout = originalSetTimeout
      window.clearTimeout = originalClearTimeout
      assert.equal(timers.size, 0)
    },
  }
}

function messages(host: HTMLElement) {
  return [...host.querySelectorAll('.global-toast-message')].map((element) => element.textContent)
}

test('notices appear immediately in arrival order and expire together after three seconds and fading', async () => {
  const view = await mountToasts()
  try {
    act(() => {
      view.toasts.showToast('info', '第一条')
      view.toasts.showToast('error', '第二条')
      view.toasts.showToast('info', '第三条')
    })
    assert.deepEqual(messages(view.host), ['第一条', '第二条', '第三条'])
    assert.equal(view.host.querySelectorAll('[role="alert"]').length, 1)
    await view.advance(2999)
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(1)
    assert.equal(view.host.querySelectorAll('.is-leaving').length, 3)
    await view.advance(239)
    assert.equal(view.host.querySelectorAll('.global-toast').length, 3)
    await view.advance(1)
    assert.equal(view.host.querySelector('.global-toast-stack'), null)
    assert.equal(view.toasts.notices.length, 0)
  } finally { view.unmount() }
})

test('each notice keeps its own lifetime including notices arriving during another notice fading', async () => {
  const view = await mountToasts()
  try {
    act(() => view.toasts.showToast('info', '第一条'))
    await view.advance(1000)
    act(() => view.toasts.showToast('info', '第二条'))
    await view.advance(2000)
    assert.equal(view.host.querySelectorAll('.is-leaving').length, 1)
    act(() => view.toasts.showToast('info', '第三条'))
    assert.deepEqual(messages(view.host), ['第一条', '第二条', '第三条'])
    await view.advance(240)
    assert.deepEqual(messages(view.host), ['第二条', '第三条'])
    await view.advance(759)
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(1)
    assert.equal(view.host.querySelectorAll('.is-leaving').length, 1)
    await view.advance(240)
    assert.deepEqual(messages(view.host), ['第三条'])
    await view.advance(1759)
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(1)
    assert.ok(view.host.querySelector('.is-leaving'))
    await view.advance(240)
    assert.equal(view.host.querySelector('.global-toast'), null)
  } finally { view.unmount() }
})

test('closing a middle notice removes only that notice and does not reset other timers', async () => {
  const view = await mountToasts()
  try {
    act(() => {
      view.toasts.showToast('info', '第一条')
      view.toasts.showToast('info', '第二条')
      view.toasts.showToast('info', '第三条')
    })
    const middleId = view.toasts.notices[1].id
    await view.advance(500)
    act(() => view.host.querySelectorAll<HTMLButtonElement>('[aria-label="关闭提示"]')[1].click())
    assert.equal(view.host.querySelectorAll('.is-leaving').length, 1)
    await view.advance(239)
    assert.equal(view.toasts.notices.length, 3)
    await view.advance(1)
    assert.deepEqual(messages(view.host), ['第一条', '第三条'])
    act(() => view.toasts.dismissToast(middleId))
    assert.deepEqual(messages(view.host), ['第一条', '第三条'])
    await view.advance(2259)
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(1)
    assert.equal(view.host.querySelectorAll('.is-leaving').length, 2)
    await view.advance(240)
    assert.equal(view.host.querySelector('.global-toast'), null)
  } finally { view.unmount() }
})

test('notice actions execute once and resulting notices appear immediately', async () => {
  const view = await mountToasts()
  let actions = 0
  try {
    act(() => view.toasts.showToast('error', '连接失败', {
      label: '重试',
      onClick: () => {
        actions++
        view.toasts.showToast('info', '已发起重试')
      },
    }))
    const button = view.host.querySelector<HTMLButtonElement>('[aria-label="重试"]')!
    act(() => button.click())
    act(() => button.click())
    assert.equal(actions, 1)
    assert.equal(button.disabled, true)
    assert.deepEqual(messages(view.host), ['连接失败', '已发起重试'])
    await view.advance(240)
    assert.deepEqual(messages(view.host), ['已发起重试'])
    assert.equal(view.host.querySelector('.is-leaving'), null)
  } finally { view.unmount() }
})

test('operation progress remains cancellable and persistent alongside multiple notices', async () => {
  const view = await mountToasts()
  let cancellations = 0
  try {
    await view.setProgress({ message: '正在复制…', onCancel: () => { cancellations++ } })
    assert.equal(view.timers.size, 0)
    await view.advance(60000)
    assert.ok(view.host.textContent?.includes('正在复制…'))
    act(() => view.host.querySelector<HTMLButtonElement>('button')!.click())
    assert.equal(cancellations, 1)
    act(() => {
      view.toasts.showToast('error', '取消操作失败')
      view.toasts.showToast('info', '路径已复制')
    })
    assert.deepEqual(messages(view.host), ['正在复制…', '取消操作失败', '路径已复制'])
    await view.advance(3240)
    assert.deepEqual(messages(view.host), ['正在复制…'])
    assert.equal(view.timers.size, 0)
    await view.setProgress(null)
    act(() => view.toasts.showToast('info', '复制已完成'))
    assert.deepEqual(messages(view.host), ['复制已完成'])
  } finally { view.unmount() }
})
