import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import type { PerformanceMonitorState, PerformanceSnapshot } from '../src/shared/types.ts'
import { DEFAULT_PERFORMANCE_THRESHOLDS } from '../src/shared/app-settings.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  Element: { configurable: true, value: dom.window.Element },
  Node: { configurable: true, value: dom.window.Node },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true, writable: true },
})

test('expanded performance monitor displays readable metrics and keeps refresh and dismissal actions available', async () => {
  const [{ createRoot }, { default: PerformanceMonitor }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/components/PerformanceMonitor.tsx'),
  ])
  const now = new Date().toISOString()
  const snapshot: PerformanceSnapshot = {
    sampledAt: now,
    cpuPercent: 24,
    memoryPercent: 46,
    memoryUsedBytes: 460,
    memoryTotalBytes: 1000,
    diskPercent: 61,
    diskUsedBytes: 610,
    diskTotalBytes: 1000,
    loadAverage: [0.35, 0.42, 0.38],
    uptimeSeconds: 12345,
    cpuCores: 8,
  }
  const state: PerformanceMonitorState = {
    sessionId: 'session-1',
    version: 1,
    status: 'ready',
    snapshot,
    message: null,
    history: [[snapshot]],
  }
  const refreshed: string[] = []
  const openChanges: boolean[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  try {
    act(() => root.render(createElement(PerformanceMonitor, {
      state,
      thresholds: DEFAULT_PERFORMANCE_THRESHOLDS,
      open: true,
      onOpenChange: (open: boolean) => openChanges.push(open),
      onRefresh: (sessionId: string) => refreshed.push(sessionId),
    })))

    const dialog = host.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.equal(host.querySelectorAll('.performance-trend-row').length, 3)
    for (const [label, percent] of [
      ['CPU 使用率', '24%'],
      ['内存使用率', '46%'],
      ['根分区使用率', '61%'],
    ]) {
      const row = [...host.querySelectorAll('.performance-trend-row')].find((element) => element.textContent?.includes(label))
      assert.ok(row, `missing ${label}`)
      assert.ok(row.textContent?.includes(percent), `missing ${percent} for ${label}`)
      assert.ok(row.querySelector('svg[role="img"][aria-label]'), `${label} should have an accessible trend chart`)
    }

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="立即刷新性能指标"]')?.click())
    assert.deepEqual(refreshed, ['session-1'])

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="关闭性能监控"]')?.click())
    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' })))
    assert.deepEqual(openChanges, [false, false])
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
