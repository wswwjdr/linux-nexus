import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, type ComponentProps } from 'react'
import { JSDOM } from 'jsdom'
import GlobalToast from '../src/renderer/src/GlobalToast.tsx'
import { useToastQueue } from '../src/renderer/src/hooks/useToastQueue.ts'

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
  let queue!: ReturnType<typeof useToastQueue>
  let progress: ComponentProps<typeof GlobalToast>['progress'] = null
  function Harness() {
    queue = useToastQueue()
    return createElement(GlobalToast, { notice: queue.toast, onDismiss: queue.dismissToast, progress })
  }
  await act(async () => root.render(createElement(Harness)))

  return {
    host,
    timers,
    get queue() { return queue },
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

test('notices are shown in FIFO order with a full lifetime and fade before advancing, including arrivals during fading', async () => {
  const view = await mountToasts()
  try {
    act(() => {
      view.queue.showToast('info', '第一条')
      view.queue.showToast('error', '第二条')
      view.queue.showToast('info', '第三条')
    })
    assert.equal(view.host.querySelectorAll('.global-toast').length, 1)
    assert.ok(view.host.textContent?.includes('第一条'))
    assert.ok(!view.host.textContent?.includes('第二条'))
    await view.advance(5999)
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(1)
    assert.ok(view.host.querySelector('.is-leaving'))
    act(() => view.queue.showToast('info', '第四条'))
    await view.advance(239)
    assert.ok(view.host.textContent?.includes('第一条'))
    await view.advance(1)
    assert.ok(view.host.querySelector('[role="alert"]')?.textContent?.includes('第二条'))
    assert.equal(view.host.querySelector('.is-leaving'), null)
    await view.advance(6000)
    assert.ok(view.host.querySelector('.is-leaving'))
    await view.advance(240)
    assert.ok(view.host.textContent?.includes('第三条'))
    await view.advance(6240)
    assert.ok(view.host.textContent?.includes('第四条'))
    await view.advance(6240)
    assert.equal(view.host.querySelector('.global-toast'), null)
  } finally { view.unmount() }
})

test('manual dismissal fades before advancing and a stale dismissal cannot discard the next notice', async () => {
  const view = await mountToasts()
  try {
    act(() => {
      view.queue.showToast('info', '第一条')
      view.queue.showToast('info', '第二条')
    })
    const firstId = view.queue.toast!.id
    await view.advance(500)
    act(() => view.host.querySelector<HTMLButtonElement>('[aria-label="关闭提示"]')!.click())
    assert.ok(view.host.querySelector('.is-leaving'))
    await view.advance(239)
    assert.equal(view.queue.toast?.id, firstId)
    await view.advance(1)
    assert.ok(view.host.textContent?.includes('第二条'))
    act(() => view.queue.dismissToast(firstId))
    assert.ok(view.host.textContent?.includes('第二条'))
    await view.advance(5999)
    assert.equal(view.host.querySelector('.is-leaving'), null)
  } finally { view.unmount() }
})

test('notice actions execute once and any resulting notice joins the queue after the current fade', async () => {
  const view = await mountToasts()
  let actions = 0
  try {
    act(() => view.queue.showToast('error', '连接失败', {
      label: '重试',
      onClick: () => {
        actions++
        view.queue.showToast('info', '已发起重试')
      },
    }))
    const button = view.host.querySelector<HTMLButtonElement>('[aria-label="重试"]')!
    act(() => button.click())
    act(() => button.click())
    assert.equal(actions, 1)
    assert.equal(button.disabled, true)
    assert.ok(view.host.textContent?.includes('连接失败'))
    await view.advance(240)
    assert.ok(view.host.textContent?.includes('已发起重试'))
    assert.equal(view.host.querySelector('.is-leaving'), null)
  } finally { view.unmount() }
})

test('operation progress does not expire or block the notice queue and remains cancellable', async () => {
  const view = await mountToasts()
  let cancellations = 0
  try {
    await view.setProgress({ message: '正在复制…', onCancel: () => { cancellations++ } })
    assert.equal(view.timers.size, 0)
    await view.advance(60000)
    assert.ok(view.host.textContent?.includes('正在复制…'))
    act(() => view.host.querySelector<HTMLButtonElement>('button')!.click())
    assert.equal(cancellations, 1)
    act(() => view.queue.showToast('error', '取消操作失败'))
    assert.equal(view.host.querySelectorAll('.global-toast').length, 2)
    await view.advance(6240)
    assert.equal(view.host.querySelector('[role="alert"]'), null)
    assert.ok(view.host.textContent?.includes('正在复制…'))
    assert.equal(view.timers.size, 0)
    await view.setProgress(null)
    act(() => view.queue.showToast('info', '复制已完成'))
    assert.ok(!view.host.textContent?.includes('正在复制'))
    assert.ok(view.host.textContent?.includes('复制已完成'))
  } finally { view.unmount() }
})
