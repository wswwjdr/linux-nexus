const { app, BrowserWindow, nativeTheme } = require('electron')
const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')

app.setPath('userData', require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'nexus-browser-')))
app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const server = await createServer({
    configFile: false, cacheDir: require('node:path').join(app.getPath('userData'), 'vite-cache'), resolve: { alias: { '@': require('node:path').resolve('src/renderer/src'), '@shared': require('node:path').resolve('src/shared') } },
    plugins: [react(), {
      name: 'text-preview-test-page',
      configureServer(server) {
        server.middlewares.use('/__text_preview_test', async (_request, response) => {
          const html = await server.transformIndexHtml('/__text_preview_test', `
            <html><head><meta charset="utf-8"></head><body>
            <div class="modal-backdrop preview-backdrop"><section class="modal preview-modal media-preview-modal text-preview-modal">
              <div class="modal-heading"><h2>文本搜索验证.txt</h2></div><div id="root" style="display:contents"></div>
            </section></div>
            <script type="module">
import { setLanguage } from '/src/shared/i18n/messages.ts'; setLanguage('zh-CN');
              import React, { useRef, useState } from 'react';
              import { createRoot } from 'react-dom/client';
              import TextPreviewPanel from '/src/renderer/src/components/previews/TextPreviewPanel.tsx';
              import LogPreviewPanel from '/src/renderer/src/components/previews/LogPreviewPanel.tsx';
              import '/src/renderer/src/styles/foundation.css';
              import '/src/renderer/src/styles/dialogs.css';
              import '/src/renderer/src/styles/theme.css';
              const original = Array.from({ length: 180 }, (_, i) => i === 120
                ? '中文\\t' + 'x'.repeat(180) + ' NEEDLE' : '第 ' + (i + 1) + ' 行：文本内容').join('\\n') + '\\nNEEDLE';
              function Fixture() {
                const [draft, setDraft] = useState(original);
                const viewportRef = useRef(null);
                if (location.search === '?log') {
                  window.prependLogPage = () => setDraft(value => 'earlier NEEDLE\\n' + value);
                  return React.createElement(LogPreviewPanel, { dialog: { kind: 'ready', content: draft,
                    name: 'app.log', sessionId: 's', path: '/app.log', startOffset: 100, fileSize: 10000,
                    limitBytes: 10000, hasEarlier: true, loadingEarlier: false }, viewportRef, onScroll: () => {} });
                }
                return React.createElement(TextPreviewPanel, { draft, dirty: draft !== original, saving: false,
                  saveConfirmationOpen: false, onUpdateDraft: setDraft, onRequestSave: () => {} });
              }
              createRoot(document.getElementById('root')).render(React.createElement(Fixture));
            </script></body></html>`)
          response.setHeader('Content-Type', 'text/html')
          response.end(html)
        })
      },
    }],
    server: { host: '127.0.0.1', port: 0, watch: null },
  })
  const window = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: { sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
  try {
    await server.listen()
    await window.loadURL(server.resolvedUrls.local[0] + '__text_preview_test')
    // Wait for the transformed React entry to mount, bounded by the parent process timeout.
    while (!await window.webContents.executeJavaScript('Boolean(document.querySelector("textarea"))')) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    for (const [width, height, dark] of [[640, 480, false], [1050, 728, true]]) {
      nativeTheme.themeSource = dark ? 'dark' : 'light'
      window.setContentSize(width, height)
      const result = await window.webContents.executeJavaScript(`(${checkSearch.toString()})()`)
      assert.deepEqual(result, [], result.join('\n'))
    }
    await window.loadURL(server.resolvedUrls.local[0] + '__text_preview_test?log')
    while (!await window.webContents.executeJavaScript('Boolean(document.querySelector(".log-preview-text"))')) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    for (const [width, height] of [[640, 480], [1050, 728]]) {
      window.setContentSize(width, height)
      const result = await window.webContents.executeJavaScript(`(${checkLogSearch.toString()})()`)
      assert.deepEqual(result, [], result.join('\n'))
    }
    if (process.env.TEXT_SEARCH_SCREENSHOT_PATH) {
      await window.webContents.capturePage(undefined, { stayHidden: true })
      writeFileSync(process.env.TEXT_SEARCH_SCREENSHOT_PATH, (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    }
    console.log('text search browser checks passed')
  } finally {
    window.destroy()
    await server.close()
  }
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })

async function checkSearch() {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  const editor = document.querySelector('textarea')
  editor.setSelectionRange(0, 0)
  document.querySelector('.text-preview-find').click()
  await tick()
  const input = document.querySelector('[aria-label="搜索文本"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'NEEDLE')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  check(document.activeElement === input, 'search must keep focus while typing')
  check(editor.scrollTop > 0 && editor.scrollLeft > 0, 'distant long-line match must scroll vertically and horizontally')
  const visibleMatch = () => {
    const marker = document.querySelector('mark').getBoundingClientRect()
    const viewport = editor.getBoundingClientRect()
    check(marker.top >= viewport.top && marker.bottom <= viewport.bottom, 'match must be visible vertically')
    check(marker.left >= viewport.left && marker.right <= viewport.right, 'match must be visible horizontally')
  }
  visibleMatch()
  const mirror = document.querySelector('.text-preview-highlight')
  check(Math.abs(mirror.scrollTop - editor.scrollTop) < 1 && Math.abs(mirror.scrollLeft - editor.scrollLeft) < 1, `highlight must align with editor scroll: mirror ${mirror.scrollLeft},${mirror.scrollTop} width ${mirror.clientWidth}/${mirror.scrollWidth}; editor ${editor.scrollLeft},${editor.scrollTop} width ${editor.clientWidth}/${editor.scrollWidth}`)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await tick()
  check(document.querySelector('.text-preview-search-count').textContent === '2 / 2', 'Enter must select the last match')
  visibleMatch()
  check(editor.scrollLeft === 0, 'short-line match must reset horizontal scrolling')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await tick()
  check(document.querySelector('.text-preview-search-count').textContent === '1 / 2', 'navigation must wrap to the first match')
  visibleMatch()
  const editorStyle = getComputedStyle(editor)
  const mirrorStyle = getComputedStyle(mirror)
  for (const property of ['fontFamily', 'fontSize', 'lineHeight', 'paddingTop', 'paddingLeft', 'whiteSpace', 'tabSize']) {
    check(editorStyle[property] === mirrorStyle[property], 'editor and highlight must share ' + property)
  }
  for (const selector of ['.text-preview-search', '.text-preview-footer']) {
    const bounds = document.querySelector(selector).getBoundingClientRect()
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, selector + ' must fit in the window')
  }
  return errors
}

async function checkLogSearch() {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  document.querySelector('.text-preview-find').click()
  await tick()
  const input = document.querySelector('[aria-label="搜索文本"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'NEEDLE')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  const viewport = document.querySelector('.log-preview-text')
  const visible = () => {
    const marker = document.querySelector('mark').getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    check(marker.top >= bounds.top && marker.bottom <= bounds.bottom, 'log match must be visible in its scroll viewport')
    check(document.activeElement === input, 'log navigation must retain search focus')
  }
  visible()
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
  await tick()
  visible()
  const countBefore = document.querySelector('.text-preview-search-count').textContent.split(' / ').map(Number)
  window.prependLogPage()
  await tick()
  const countAfter = document.querySelector('.text-preview-search-count').textContent.split(' / ').map(Number)
  check(countAfter[0] === countBefore[0] + 1 && countAfter[1] === countBefore[1] + 1, 'prepending a log page must update counts and preserve the current match')
  for (const selector of ['.text-preview-search', '.text-preview-footer']) {
    const bounds = document.querySelector(selector).getBoundingClientRect()
    check(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, selector + ' must fit with a log viewport')
  }
  return errors
}
