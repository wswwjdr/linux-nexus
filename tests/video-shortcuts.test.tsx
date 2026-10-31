import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useRef } from 'react'
import { JSDOM } from 'jsdom'
import type Player from 'video.js/dist/types/player'
import { useVideoShortcuts } from '../src/renderer/src/components/previews/video/useVideoShortcuts'

test('video long press restores the previous rate on release, blur and session loss, and ignores unrelated keyup', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>')
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!, root = createRoot(host)
  const play = () => {}, report = () => {}
  const fake = { el: () => host, isFullscreen: () => false } as unknown as Player
  function Harness({ active }: { active: boolean }) {
    const player = useRef(fake), dialog = useRef<HTMLElement>(null)
    useVideoShortcuts(player, dialog, active, play, report)
    return createElement('section', { ref: dialog }, createElement('video'))
  }
  const render = (active: boolean) => act(() => root.render(createElement(Harness, { active })))
  const key = (type: string, key: string, options: KeyboardEventInit = {}) => {
    const event = new dom.window.KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...options })
    host.querySelector('video')!.dispatchEvent(event)
    return event
  }
  const hold = async () => { key('keydown', 'ArrowRight'); await new Promise((resolve) => setTimeout(resolve, 550)) }
  try {
    render(true)
    const video = host.querySelector('video')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 100 })
    video.currentTime = 20; video.playbackRate = 1.5
    key('keyup', 'ArrowRight'); assert.equal(video.currentTime, 20)
    key('keydown', 'ArrowRight'); key('keyup', 'ArrowRight'); assert.equal(video.currentTime, 25)
    await hold(); assert.equal(video.playbackRate, 2)
    key('keyup', 'ArrowRight'); assert.equal(video.playbackRate, 1.5); assert.equal(video.currentTime, 25)
    await hold(); window.dispatchEvent(new dom.window.Event('blur')); assert.equal(video.playbackRate, 1.5)
    await hold(); render(false); assert.equal(video.playbackRate, 1.5)
    assert.equal(key('keydown', 'ArrowRight').defaultPrevented, false)
    key('keyup', 'ArrowRight'); assert.equal(video.currentTime, 25)
    render(true)
    key('keydown', 'ArrowLeft'); assert.equal(video.currentTime, 20)
    key('keydown', 'ArrowRight', { ctrlKey: true }); key('keyup', 'ArrowRight'); assert.equal(video.currentTime, 20)
  } finally { act(() => root.unmount()); dom.window.close() }
})
