import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, StrictMode } from 'react'
import { JSDOM } from 'jsdom'
import AudioPreviewDialog from '../src/renderer/src/components/previews/audio/AudioPreviewDialog'

async function fixture(options: { active?: boolean; rejectPlay?: string; strict?: boolean } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="opener">打开</button><div id="root"></div></body>', { url: 'http://localhost' })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    DOMException: { configurable: true, value: dom.window.DOMException },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const plays: HTMLMediaElement[] = []
  const loads: HTMLMediaElement[] = []
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  let rejectPlay = options.rejectPlay
  Object.defineProperties(dom.window.HTMLMediaElement.prototype, {
    paused: { configurable: true, get() { return paused.get(this) ?? true } },
    duration: { configurable: true, get() { return 120 } },
    play: { configurable: true, value(this: HTMLMediaElement) {
      plays.push(this)
      if (rejectPlay) return Promise.reject(new dom.window.DOMException('play failure', rejectPlay))
      paused.set(this, false)
      this.dispatchEvent(new dom.window.Event('play'))
      this.dispatchEvent(new dom.window.Event('playing'))
      return Promise.resolve()
    } },
    pause: { configurable: true, value(this: HTMLMediaElement) {
      paused.set(this, true)
      this.dispatchEvent(new dom.window.Event('pause'))
    } },
    load: { configurable: true, value(this: HTMLMediaElement) { loads.push(this) } },
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const opener = document.getElementById('opener')!
  opener.focus()
  let closes = 0
  const result = { type: 'audio' as const, name: '测试音频.mp3', url: 'http://localhost/audio.wav', token: 'audio' }
  const render = async (active: boolean) => {
    await act(async () => {
      const dialog = createElement(AudioPreviewDialog, { result, active, onClose: () => { closes++ } })
      root.render(options.strict ? createElement(StrictMode, null, dialog) : dialog)
    })
  }
  await render(options.active ?? true)
  const audio = host.querySelector('audio')!
  const key = (key: string, target: EventTarget = audio, modifiers: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
    act(() => { target.dispatchEvent(event) })
    return event
  }
  return { dom, host, audio, plays, loads, opener, render, key,
    reject: (name?: string) => { rejectPlay = name },
    closes: () => closes,
    cleanup: () => { act(() => root.unmount()); dom.window.close() },
    unmount: () => act(() => root.unmount()),
  }
}

test('audio dialog autoplays, follows actual playback events, expands help and closes', async () => {
  const f = await fixture()
  try {
    assert.equal(f.plays.length, 1)
    assert.ok(f.host.querySelector('.ap-body.playing'))
    act(() => f.audio.dispatchEvent(new f.dom.window.Event('waiting')))
    assert.equal(f.host.querySelector('.ap-body.playing'), null)
    assert.match(f.host.textContent!, /正在缓冲/)
    act(() => f.audio.dispatchEvent(new f.dom.window.Event('playing')))
    assert.ok(f.host.querySelector('.ap-body.playing'))
    const toggle = f.host.querySelector<HTMLButtonElement>('[aria-label="快捷键"]')!
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.ok(f.host.querySelector('.ap-shortcuts-collapse[inert]'))
    act(() => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    assert.equal(f.host.querySelector('.ap-shortcuts-collapse[inert]'), null)
    assert.equal(f.key(' ', toggle).defaultPrevented, false)
    assert.equal(f.audio.paused, false)
    act(() => f.host.querySelector<HTMLButtonElement>('[aria-label="关闭预览"]')!.click())
    assert.equal(f.closes(), 1)
    assert.equal(f.audio.paused, true)
    act(() => f.host.querySelector('.ap-overlay')!.dispatchEvent(new f.dom.window.MouseEvent('mousedown', { bubbles: true })))
    assert.equal(f.closes(), 2)
    act(() => f.host.querySelector('.ap-modal')!.dispatchEvent(new f.dom.window.MouseEvent('mousedown', { bubbles: true })))
    assert.equal(f.closes(), 2)
  } finally { f.cleanup() }
})

test('audio shortcuts clamp seek, volume and speed, and avoid editable targets and modifiers', async () => {
  const f = await fixture()
  try {
    f.audio.currentTime = 60
    assert.equal(f.key('ArrowLeft').defaultPrevented, true)
    assert.equal(f.audio.currentTime, 55)
    f.key('ArrowRight'); f.key('J')
    assert.equal(f.audio.currentTime, 50)
    f.key('L'); assert.equal(f.audio.currentTime, 60)
    f.key('Home'); f.key('ArrowLeft'); assert.equal(f.audio.currentTime, 0)
    f.key('End'); f.key('l'); assert.equal(f.audio.currentTime, 120)
    Object.defineProperty(f.audio, 'duration', { configurable: true, value: NaN })
    f.audio.currentTime = 20
    f.key('ArrowRight'); f.key('End'); assert.equal(f.audio.currentTime, 20)
    f.audio.volume = .5
    f.key('ArrowUp'); assert.equal(f.audio.volume, .6)
    f.key('ArrowDown'); assert.equal(f.audio.volume, .5)
    for (let i = 0; i < 50; i++) { f.key('ArrowUp'); f.key('>') }
    assert.equal(f.audio.volume, 1); assert.equal(f.audio.playbackRate, 4)
    for (let i = 0; i < 50; i++) { f.key('ArrowDown'); f.key('<') }
    assert.equal(f.audio.volume, 0); assert.equal(f.audio.playbackRate, .25)
    f.key('M'); assert.equal(f.audio.muted, true)
    f.key('m'); assert.equal(f.audio.muted, false)
    f.key('K'); assert.equal(f.audio.paused, true)
    assert.equal(f.key(' ', f.audio, { repeat: true }).defaultPrevented, true)
    assert.equal(f.audio.paused, true)
    await act(async () => { f.key(' ') }); assert.equal(f.audio.paused, false)
    assert.equal(f.key('k', f.audio, { ctrlKey: true }).defaultPrevented, false)
    assert.equal(f.key('k', f.audio, { altKey: true }).defaultPrevented, false)
    assert.equal(f.key('k', f.audio, { metaKey: true }).defaultPrevented, false)
    assert.equal(f.key('k', f.audio, { isComposing: true }).defaultPrevented, false)
    const input = f.dom.window.document.createElement('input')
    f.host.querySelector('.ap-modal')!.append(input)
    assert.equal(f.key('k', input).defaultPrevented, false)
    assert.equal(f.key('k', f.opener).defaultPrevented, false)
    assert.equal(f.audio.paused, false)
    assert.equal(f.key('Escape').defaultPrevented, false) // Workspace owns Escape.
  } finally { f.cleanup() }
})

test('inactive audio pauses without losing state, never resumes automatically, and cleans up on unmount', async () => {
  const f = await fixture()
  try {
    f.audio.currentTime = 42; f.audio.volume = .4; f.audio.playbackRate = 1.5
    act(() => f.host.querySelector<HTMLButtonElement>('[aria-label="快捷键"]')!.click())
    await f.render(false)
    assert.equal(f.audio.paused, true)
    assert.equal(f.loads.length, 0)
    assert.equal(f.key('ArrowRight').defaultPrevented, false)
    await f.render(true)
    assert.equal(f.plays.length, 1)
    assert.equal(f.audio.currentTime, 42); assert.equal(f.audio.volume, .4); assert.equal(f.audio.playbackRate, 1.5)
    assert.equal(f.host.querySelector('[aria-label="快捷键"]')!.getAttribute('aria-expanded'), 'true')
    f.unmount()
    assert.equal(f.audio.paused, true)
    assert.equal(f.audio.getAttribute('src'), null)
    assert.equal(f.loads.length, 1)
    assert.equal(f.key('k', f.dom.window).defaultPrevented, false)
    assert.equal(f.dom.window.document.activeElement, f.opener)
  } finally { f.cleanup() }
  const hidden = await fixture({ active: false })
  try {
    await hidden.render(true)
    assert.equal(hidden.plays.length, 0)
  } finally { hidden.cleanup() }
})

test('play failures and media errors are visible and a later successful play clears feedback', async () => {
  const f = await fixture({ rejectPlay: 'NotAllowedError' })
  try {
    assert.match(f.host.querySelector('[role="status"]')!.textContent!, /自动播放被阻止/)
    f.reject('NotSupportedError')
    await act(async () => { f.key('k') })
    assert.match(f.host.querySelector('[role="alert"]')!.textContent!, /播放失败/)
    f.reject()
    await act(async () => { f.key('k') })
    assert.equal(f.host.querySelector('[role="alert"]'), null)
    Object.defineProperty(f.audio, 'error', { configurable: true, value: { code: 3 } })
    act(() => f.audio.dispatchEvent(new f.dom.window.Event('error')))
    assert.match(f.host.querySelector('[role="alert"]')!.textContent!, /解码失败/)
    assert.equal(f.host.querySelector('.ap-body.playing'), null)
  } finally { f.cleanup() }
})

test('StrictMode effect replay retains a playable source and an active animation', async () => {
  const f = await fixture({ strict: true })
  try {
    assert.equal(f.audio.src, 'http://localhost/audio.wav')
    assert.equal(f.audio.paused, false)
    assert.ok(f.host.querySelector('.ap-body.playing'))
  } finally { f.cleanup() }
})
