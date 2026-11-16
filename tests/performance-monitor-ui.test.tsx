import assert from 'node:assert/strict'
import test from 'node:test'
import React, { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { DEFAULT_PERFORMANCE_THRESHOLDS } from '../src/shared/app-settings.ts'
import { setLanguage } from '../src/shared/i18n/messages.ts'
import type { PerformanceMonitorState } from '../src/shared/types/performance.ts'
import { performanceUiFixture } from './helpers/performance-fixture.ts'

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

test('the monitor starts off and displays all live resources after enabling, with keyboard focus restored on dismissal', async () => {
  const [{ createRoot }, { default: PerformanceMonitor }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/components/PerformanceMonitor.tsx'),
  ])
  const state = performanceUiFixture(256)
  let refreshed = 0
  const enabledChanges: boolean[] = []
  const openChanges: boolean[] = []
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)

  try {
    /** Renders the panel with the supplied monitor state. */
    const render = (monitor: typeof state) => act(() => root.render(createElement(PerformanceMonitor, {
      state: monitor,
      thresholds: DEFAULT_PERFORMANCE_THRESHOLDS,
      open: true,
      onOpenChange: (open: boolean) => openChanges.push(open),
      onEnabledChange: (enabled: boolean) => enabledChanges.push(enabled),
      onRefresh: () => { refreshed += 1 },
    })))
    render({ ...state, enabled: false, metrics: {} })
    const toggle = host.querySelector<HTMLInputElement>('[role="switch"]')!
    assert.equal(document.activeElement, toggle)
    assert.match(host.textContent!, /监控已关闭/)
    assert.equal(host.querySelector<HTMLButtonElement>('[aria-label="立即刷新性能指标"]')?.disabled, true)
    act(() => toggle.click())
    assert.deepEqual(enabledChanges, [true])
    render(state)
    const dialog = host.querySelector('[role="dialog"]')
    assert.ok(dialog)
    assert.match(dialog.textContent!, /0\.4%/)
    assert.match(dialog.textContent!, /CPU 0（100%）/)
    assert.match(dialog.textContent!, /未配置交换空间/)
    assert.equal(dialog.querySelectorAll('.performance-cpu-list li').length, 16)
    assert.match(dialog.textContent!, /严重/)
    assert.equal(dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '存储')
    const expand = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.includes('256'))!
    act(() => expand.click())
    assert.equal(expand.getAttribute('aria-expanded'), 'true')
    assert.equal(dialog.querySelectorAll('.performance-cpu-list li').length, 256)
    act(() => expand.click())
    assert.equal(dialog.querySelectorAll('.performance-cpu-list li').length, 16)

    const storage = dialog.querySelector('[role="tab"][aria-selected="true"]')!
    act(() => storage.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    const io = dialog.querySelector('[role="tab"][aria-selected="true"]')!
    assert.equal(document.activeElement, io)
    assert.match(dialog.querySelector('[role="tabpanel"]')!.textContent!, /等待下一次采样/)
    act(() => io.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    assert.match(dialog.querySelector('[role="tabpanel"]')!.textContent!, /eth0/)
    act(() => (storage as HTMLButtonElement).click())

    act(() => host.querySelector<HTMLButtonElement>('[aria-label="立即刷新性能指标"]')?.click())
    assert.equal(refreshed, 1)
    act(() => setLanguage('en'))
    assert.match(dialog.textContent!, /Busiest: CPU 0 \(100%\)/)
    assert.match(dialog.textContent!, /Local mount points/)
    const { latest } = state.metrics.mounts!
    const overlay = latest!.value[1]
    render({ ...state, metrics: { ...state.metrics, mounts: {
      latest: { sampledAt: latest!.sampledAt, value: [
        { ...latest!.value[0], fsType: 'overlay' },
        ...Array.from({ length: 23 }, (_, index) => ({ ...overlay, target: overlay.target + index })),
      ] },
      error: null,
    } } })
    const group = dialog.querySelector<HTMLDetailsElement>('.performance-resource-group')!
    assert.equal(group.open, false)
    assert.match(group.querySelector('summary')!.textContent!, /Overlay mounts \(23\)/)
    assert.equal(dialog.querySelector('.performance-table tbody th')?.textContent, '/')
    act(() => group.querySelector('summary')!.click())
    assert.equal(group.open, true)
    assert.equal(group.querySelectorAll('tbody tr').length, 10)
    const longName = group.querySelector<HTMLDetailsElement>('.performance-resource-name')!
    act(() => longName.querySelector('summary')!.click())
    assert.equal(longName.open, true)
    assert.equal(longName.textContent, overlay.target + '0')
    act(() => group.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click())
    act(() => group.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!.click())
    assert.equal(group.querySelectorAll('tbody tr').length, 3)
    assert.match(group.textContent!, /Page 3 of 3/)
    render({ ...state, metrics: { ...state.metrics, mounts: { latest: state.metrics.mounts!.latest, error: 'df failed' } } })
    assert.match(dialog.textContent!, /Last successful sample at.*df failed/)
    assert.match(dialog.textContent!, /61%/)
    assert.doesNotMatch(host.querySelector('.performance-summary-button')!.textContent!, /61%/)

    act(() => window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true })))
    assert.deepEqual(openChanges, [false])
    assert.equal(document.activeElement, host.querySelector('.performance-summary-button'))
  } finally {
    act(() => root.unmount())
    setLanguage('zh-CN')
    host.remove()
  }
})

test('performance popover isolates background wheel events only while open', async () => {
  const [{ createRoot }, { default: PerformanceMonitor }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/components/PerformanceMonitor.tsx'),
  ])
  const host = document.createElement('div')
  const background = document.createElement('div')
  document.body.append(host, background)
  const root = createRoot(host)
  let backgroundWheelCount = 0
  background.addEventListener('wheel', () => backgroundWheelCount++)
  const wheel = (target: Element) => {
    const event = new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    target.dispatchEvent(event)
    return event
  }
  const render = (open: boolean) => act(() => root.render(createElement(PerformanceMonitor, {
    state: null,
    thresholds: DEFAULT_PERFORMANCE_THRESHOLDS,
    open,
    onOpenChange: () => {},
    onEnabledChange: () => {},
    onRefresh: () => {},
  })))

  try {
    render(false)
    assert.equal(wheel(background).defaultPrevented, false)
    assert.equal(backgroundWheelCount, 1)

    render(true)
    assert.equal(wheel(background).defaultPrevented, true)
    assert.equal(backgroundWheelCount, 1, 'background handlers must not receive wheel events while open')
    const content = host.querySelector('.performance-popover')!
    assert.equal(wheel(content).defaultPrevented, false, 'popover content must retain native scrolling')

    render(false)
    assert.equal(wheel(background).defaultPrevented, false)
    assert.equal(backgroundWheelCount, 2, 'closing must restore background wheel handling')

    render(true)
    act(() => root.unmount())
    assert.equal(wheel(background).defaultPrevented, false)
    assert.equal(backgroundWheelCount, 3, 'unmounting must remove the wheel listener')
  } finally {
    act(() => root.unmount())
    host.remove()
    background.remove()
  }
})

test('the selected server keeps its latest state when background updates and snapshots arrive out of order', async () => {
  const [{ createRoot }, { usePerformanceMonitoring }] = await Promise.all([
    import('react-dom/client'),
    import('../src/renderer/src/features/performance/usePerformanceMonitoring.ts'),
  ])
  const host = document.createElement('div')
  const root = createRoot(host)
  const pending = new Map<string, (state: PerformanceMonitorState) => void>()
  const controls: [string, boolean?][] = []
  let listener: ((state: PerformanceMonitorState) => void) | undefined
  const api = {
    /**
     * Records a snapshot request until the test delivers its response.
     * @param profileId Requested server configuration.
     * @returns The pending snapshot response.
     */
    getPerformanceMonitorState(profileId: string) {
      return new Promise<PerformanceMonitorState>((resolve) => pending.set(profileId, resolve))
    },
    /**
     * Connects the renderer to the mocked stream of versioned states.
     * @param callback Listener for pushed snapshots.
     * @returns A function to stop listening.
     */
    onPerformanceUpdate(callback: (state: PerformanceMonitorState) => void) {
      listener = callback
      return () => { listener = undefined }
    },
    /**
     * Records a switch action.
     * @param profileId Server whose switch is changing.
     * @param enabled Desired switch value.
     * @returns The server's acknowledgement.
     */
    async setPerformanceMonitorEnabled(profileId: string, enabled: boolean) {
      controls.push([profileId, enabled])
      return snapshot(profileId, 100, enabled)
    },
    /**
     * Records the server targeted by a refresh.
     * @param profileId Server to refresh.
     * @returns A resolved acknowledgement.
     */
    async refreshPerformanceMonitor(profileId: string) {
      controls.push([profileId])
    },
  }
  Object.defineProperty(window, 'remoteFiles', { configurable: true, value: api })

  /**
   * Creates a snapshot with the requested server and version.
   * @param profileId Target server configuration.
   * @param version Snapshot sequence number.
   * @param enabled Whether monitoring is enabled.
   * @returns The simulated server state.
   */
  function snapshot(profileId: string, version: number, enabled: boolean): PerformanceMonitorState {
    return { profileId, version, connected: true, enabled, sampling: false, metrics: {} }
  }

  /** Throws if an IPC action unexpectedly fails during the test. */
  function showToast() { assert.fail('Unexpected monitor IPC error') }

  /**
   * Exposes the hook through controls and a visible snapshot for assertions.
   * @param props Selected server configuration.
   * @returns A small renderer using the shared monitor hook.
   */
  function MonitorHarness({ profileId }: { profileId: string }) {
    const monitor = usePerformanceMonitoring(profileId, showToast)
    return <>
      <output>{monitor.state && `${monitor.state.profileId}:${monitor.state.version}:${monitor.state.enabled}`}</output>
      <button id="panel" onClick={() => monitor.setPanelOpen(true)} aria-expanded={monitor.panelOpen} />
      <button id="enable" onClick={() => monitor.setEnabled(true)} />
      <button id="refresh" onClick={monitor.refresh} />
    </>
  }

  /**
   * Selects the specified server in the test renderer.
   * @param profileId Newly selected configuration.
   */
  function select(profileId: string) {
    act(() => root.render(createElement(MonitorHarness, { profileId })))
  }

  try {
    select('a')
    act(() => listener!(snapshot('a', 5, true)))
    act(() => host.querySelector<HTMLButtonElement>('#panel')!.click())
    select('a')
    assert.equal(host.querySelector('#panel')?.getAttribute('aria-expanded'), 'true')

    select('b')
    assert.equal(host.querySelector('#panel')?.getAttribute('aria-expanded'), 'false')
    act(() => {
      listener!(snapshot('b', 7, false))
      listener!(snapshot('a', 8, true))
    })
    await act(async () => {
      pending.get('a')!(snapshot('a', 1, false))
      pending.get('b')!(snapshot('b', 6, true))
    })
    assert.equal(host.querySelector('output')?.textContent, 'b:7:false')

    select('a')
    assert.equal(host.querySelector('output')?.textContent, 'a:8:true')
    assert.equal(host.querySelector('#panel')?.getAttribute('aria-expanded'), 'false')
    await act(async () => {
      host.querySelector<HTMLButtonElement>('#enable')!.click()
      host.querySelector<HTMLButtonElement>('#refresh')!.click()
    })
    assert.deepEqual(controls, [['a', true], ['a']])
    assert.equal(host.querySelector('output')?.textContent, 'a:100:true')
  } finally {
    act(() => root.unmount())
    Reflect.deleteProperty(window, 'remoteFiles')
  }
})
