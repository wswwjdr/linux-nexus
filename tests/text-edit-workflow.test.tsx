import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { usePreview } from '../src/renderer/src/hooks/usePreview.ts'
import { defaultFileTypeExtensions } from '../src/shared/app-settings.ts'
const dom = new JSDOM('<html><body></body></html>', { url: 'http://localhost' })
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator }, IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
})
test('conflicts retain drafts, force requires a second explicit save, and subsequent saves use the new version', async () => {
  const { createRoot } = await import('react-dom/client')
  const version = { hash: 'a'.repeat(64), identity: 'first' }
  const next = { hash: 'b'.repeat(64), identity: 'second' }
  const calls: any[] = []
  Object.assign(window, { remoteFiles: {
    previewFile: async () => ({ type: 'text', name: 'config.txt', content: '中文', lineEnding: '\n', encoding: 'gbk', bom: false, version }),
    saveTextFile: async (...args: any[]) => { calls.push(args); return calls.length === 1 ? { status: 'conflict' } : { status: 'saved', version: next } },
    releasePreview: async () => {},
  } })
  let state!: ReturnType<typeof usePreview>
  function Harness() { state = usePreview({ sessionId: 's', fileTypeExtensions: defaultFileTypeExtensions(), showToast: () => {} }); return null }
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(createElement(Harness)))
    await act(async () => { await state.previewFile({ name: 'config.txt', path: '/config.txt' }, 'text') })
    act(() => state.updateTextDraft('修改'))
    act(() => state.requestTextSave())
    await act(async () => state.confirmTextSave())
    assert.equal(state.textConflict, true)
    assert.equal(state.textDraft, '修改')
    assert.equal(calls[0][4].force, false)
    assert.equal(calls[0][4].encoding, 'gbk')
    await act(async () => state.confirmTextSave())
    assert.equal(calls[1][4].force, true)
    assert.equal(state.textDirty, false)
    act(() => state.updateTextDraft('再修改'))
    act(() => state.requestTextSave())
    await act(async () => state.confirmTextSave())
    assert.deepEqual(calls[2][4].version, next)
    assert.equal(calls[2][4].force, false)
    act(() => state.convertTextToUtf8())
    assert.equal(state.textDirty, true)
    act(() => state.requestTextSave())
    await act(async () => state.confirmTextSave())
    assert.equal(calls[3][4].encoding, 'utf8')
    act(() => state.updateTextDraft('尚未保存的草稿'))
    window.confirm = () => true
    Object.assign(window.remoteFiles, { previewFile: async () => { throw new Error('read failed') } })
    await act(async () => state.reopenText('gbk'))
    assert.equal(state.textDraft, '尚未保存的草稿')
    assert.equal(state.textDirty, true)
    assert.equal(state.textReloading, false)
  } finally { act(() => root.unmount()) }
})
