import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import { imageFitScale, zoomAt } from '../src/renderer/src/components/previews/image/image-transform'
import { markdownImageUrl } from '../src/shared/markdown-resources'
import { collectHeadings } from '../src/renderer/src/components/previews/markdown/markdown-headings'

test('image fit considers rotation, caps small images, and keeps the zoom anchor fixed', () => {
  const image = { width: 2000, height: 1000 }, viewport = { width: 1000, height: 400 }
  assert.equal(imageFitScale(image, viewport, 0), .4)
  assert.equal(imageFitScale(image, viewport, 90), .2)
  assert.equal(imageFitScale(image, viewport, -90), .2)
  assert.equal(imageFitScale({ width: 20, height: 10 }, viewport, 0), 1)
  const before = { x: 20, y: -30 }, anchor = { x: 120, y: 70 }
  const next = zoomAt(1, 2, before, anchor)
  assert.deepEqual(next, { zoom: 2, pan: { x: -80, y: -130 } })
  assert.equal((anchor.x - next.pan.x) / next.zoom, anchor.x - before.x)
  assert.equal(zoomAt(1, -3, before, anchor).zoom, .1)
  assert.equal(zoomAt(1, 30, before, anchor).zoom, 10)
})

test('Markdown image URLs preserve server paths, percent escaping and the document capability', () => {
  const base = 'remote-preview://document/home/user/docs/readme.md'
  assert.equal(markdownImageUrl('../图片/a b.png', base), 'remote-preview://document/home/user/%E5%9B%BE%E7%89%87/a%20b.png')
  assert.equal(markdownImageUrl('/shared/a%23b.png', base), 'remote-preview://document/shared/a%23b.png')
  assert.equal(markdownImageUrl('a%2520b.png', base), 'remote-preview://document/home/user/docs/a%2520b.png')
  assert.equal(markdownImageUrl('https://example.com/a.png', base), 'https://example.com/a.png')
  for (const value of ['file:///C:/secret.png', 'javascript:alert(1)', 'data:image/svg+xml,secret', 'remote-preview://other/secret.png', 'https://user:pass@example.com/x']) assert.equal(markdownImageUrl(value, base), null)
})

test('Markdown headings support Chinese, formatted text and duplicate anchors without treating fenced headings as sections', () => {
  const headings = collectHeadings('# 标题\n## **Hello** `code`\n## 标题\n## 标题\n```md\n# ignored\n```', 'doc-')
  assert.deepEqual(headings.map(({ id, text, depth }) => ({ id, text, depth })), [
    { id: 'doc-标题', text: '标题', depth: 1 }, { id: 'doc-hello-code', text: 'Hello code', depth: 2 },
    { id: 'doc-标题-1', text: '标题', depth: 2 }, { id: 'doc-标题-2', text: '标题', depth: 2 },
  ])
})

test('Markdown reader renders GFM and offline highlighting, copies plain code, isolates failed images and controls its catalog', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>', { url: 'http://localhost' })
  let copied = '', external = ''
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window }, document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator }, HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    ResizeObserver: { configurable: true, value: class { observe() {} disconnect() {} } },
  })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied = text } } })
  const { createRoot } = await import('react-dom/client')
  const { default: MarkdownPreviewDialog } = await import('../src/renderer/src/components/previews/markdown/MarkdownPreviewDialog')
  const host = document.getElementById('root')!, root = createRoot(host)
  const content = '# 文档\n\n- [x] done\n\n~~removed~~\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```js\nconst number = 42\n```\n\n```mermaid\ngraph TD; A-->B\n```\n\n[website](https://example.com) [server](./next.md) [jump](#文档)\n\n![server](./a.png)\n\n<script>alert(1)</script>\n\n$x + y$'
  try {
    await act(async () => root.render(createElement(MarkdownPreviewDialog, {
      result: { type: 'markdown', name: 'readme.md', content, token: 'doc', resourceBaseUrl: 'remote-preview://doc/docs/readme.md' },
      active: true, onClose: () => {}, onOpenExternalLink: (url) => { external = url },
    })))
    assert.ok(host.querySelector('table'))
    assert.ok(host.querySelector('input[type="checkbox"][checked][disabled]'))
    assert.ok(host.querySelector('del'))
    assert.ok(host.querySelector('.hljs-keyword'))
    assert.equal(host.querySelector('script'), null)
    assert.match(host.textContent!, /graph TD; A-->B/)
    assert.match(host.textContent!, /\$x \+ y\$/)
    assert.equal(host.querySelector('img')!.getAttribute('src'), 'remote-preview://doc/docs/a.png')
    assert.equal(host.querySelector('img')!.getAttribute('referrerpolicy'), 'no-referrer')
    await act(async () => host.querySelector<HTMLButtonElement>('.md-copy-code')!.click())
    assert.equal(copied, 'const number = 42\n')
    assert.match(host.querySelector('[role="status"]')!.textContent!, /已复制/)
    act(() => host.querySelector<HTMLAnchorElement>('a[href="https://example.com/"]')!.click())
    assert.equal(external, 'https://example.com/')
    assert.equal(host.querySelector('a[href="./next.md"]'), null)
    const imageElement = host.querySelector('img')!
    const codeElement = host.querySelector('pre')!
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="目录"]')!.click())
    assert.equal(host.querySelector('.md-catalog')!.hasAttribute('hidden'), false)
    assert.equal(host.querySelectorAll('.md-catalog button').length, 1)
    assert.equal(host.querySelector('img'), imageElement)
    assert.equal(host.querySelector('pre'), codeElement)
    assert.match(host.querySelector('[role="status"]')!.textContent!, /已复制/)
    act(() => host.querySelector('img')!.dispatchEvent(new dom.window.Event('error')))
    assert.ok(host.querySelector('.md-image-error'))
    assert.ok(host.querySelector('table'))
  } finally { act(() => root.unmount()); dom.window.close() }
})
