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
                window.setTextPreviewDraft = setDraft;
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
    const lineNumberErrors = await window.webContents.executeJavaScript(`(${checkLineNumbers.toString()})()`)
    assert.deepEqual(lineNumberErrors, [], lineNumberErrors.join('\n'))
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

/** Checks text search, focus, and line-number alignment in the active browser fixture. Returns failed checks. */
async function checkSearch() {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  const editor = document.querySelector('textarea')
  const gutter = document.querySelector('.text-preview-gutter')
  const gutterLeft = gutter.getBoundingClientRect().left
  editor.setSelectionRange(0, 0)
  document.querySelector('.text-preview-find').click()
  await tick()
  const input = document.querySelector('[aria-label="搜索文本"]')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'NEEDLE')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await tick()
  check(document.activeElement === input, 'search must keep focus while typing')
  check(editor.scrollTop > 0 && editor.scrollLeft > 0, 'distant long-line match must scroll vertically and horizontally')
  /** Checks that the match on the given line number is visible and vertically aligned with its number. */
  const visibleMatch = (lineNumber) => {
    const match = document.querySelector('mark')
    const marker = match.getBoundingClientRect()
    const viewport = editor.getBoundingClientRect()
    check(marker.top >= viewport.top && marker.bottom <= viewport.bottom, 'match must be visible vertically')
    check(marker.left >= viewport.left && marker.right <= viewport.right, 'match must be visible horizontally')
    const number = [...gutter.querySelector('.text-preview-line-numbers').children].find(row => Number(row.textContent) === lineNumber)
    const range = document.createRange()
    if (number) range.selectNodeContents(number)
    check(number && Math.abs(range.getBoundingClientRect().top - marker.top) < 1, `search match must align with line number ${lineNumber}: number ${range.getBoundingClientRect().top}, match ${marker.top}, editor scroll ${editor.scrollTop}, mirror scroll ${match.parentElement.scrollTop}`)
    check(gutter.getBoundingClientRect().left === gutterLeft, 'horizontal scrolling must keep the gutter fixed')
  }
  visibleMatch(121)
  const mirror = document.querySelector('.text-preview-highlight')
  check(Math.abs(mirror.scrollTop - editor.scrollTop) < 1 && Math.abs(mirror.scrollLeft - editor.scrollLeft) < 1, `highlight must align with editor scroll: mirror ${mirror.scrollLeft},${mirror.scrollTop} width ${mirror.clientWidth}/${mirror.scrollWidth}; editor ${editor.scrollLeft},${editor.scrollTop} width ${editor.clientWidth}/${editor.scrollWidth}`)
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await tick()
  check(document.querySelector('.text-preview-search-count').textContent === '2 / 2', 'Enter must select the last match')
  visibleMatch(181)
  check(editor.scrollLeft === 0, 'short-line match must reset horizontal scrolling')
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  await tick()
  check(document.querySelector('.text-preview-search-count').textContent === '1 / 2', 'navigation must wrap to the first match')
  visibleMatch(121)
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

/** Exercises the line-number gutter after editing, scrolling and resizing. Returns failed checks. */
async function checkLineNumbers() {
  const errors = []
  const check = (condition, message) => { if (!condition) errors.push(message) }
  const tick = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  const editor = document.querySelector('textarea')
  const gutter = document.querySelector('.text-preview-gutter')
  const gutterViewport = gutter.querySelector('.text-preview-gutter-viewport')
  const rows = gutter.querySelector('.text-preview-line-numbers').children
  const modal = document.querySelector('.text-preview-modal')
  document.querySelector('.text-preview-search input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  check(gutter.getAttribute('aria-hidden') === 'true' && getComputedStyle(gutter).userSelect === 'none', 'line numbers must be hidden from assistive technology and unselectable')

  window.setTextPreviewDraft('')
  await tick()
  check(rows.length === 1 && rows[0].textContent === '1' && editor.value === '', 'empty files must display one line without inserting content')
  window.setTextPreviewDraft('A\r\n\rB\n')
  await tick()
  check([...rows].map(row => row.textContent).join(',') === '1,2,3,4', 'mixed endings, empty rows and the final blank row must each count correctly')

  /** Sends a native textarea edit containing the supplied draft. */
  const edit = (value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, value)
    editor.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const narrowWidth = gutter.getBoundingClientRect().width
  const tenLines = 'x\n'.repeat(9)
  edit(tenLines)
  await tick()
  check(rows.length === 10 && rows[9].textContent === '10' && gutter.getBoundingClientRect().width > narrowWidth, 'typing a tenth line must widen the gutter')
  check(editor.value === tenLines && document.querySelector('.text-preview-status').classList.contains('modified'), 'numbering must leave edits in the native editor')
  edit(tenLines.slice(0, -1))
  await tick()
  check(rows.length === 9 && gutter.getBoundingClientRect().width === narrowWidth, 'deleting the tenth line must shrink the gutter')

  window.setTextPreviewDraft('line\n'.repeat(40_000))
  await tick()
  modal.style.height = '300px'
  await tick()
  editor.scrollTop = 700_007
  await tick()
  const editorStyle = getComputedStyle(editor)
  const lineHeight = parseFloat(editorStyle.lineHeight)
  const inset = parseFloat(editorStyle.paddingTop) + editor.clientTop
  const scrollTop = editor.scrollTop
  const shortHeight = editor.clientHeight
  /** Checks the visible line-number range and offset against the editor geometry at the current size. */
  const checkViewport = () => {
    const bottomLine = Math.floor((editor.scrollTop + editor.clientHeight - inset) / lineHeight) + 1
    const row = [...rows].find(row => Number(row.textContent) === bottomLine)
    const expectedTop = editor.getBoundingClientRect().top + inset + (bottomLine - 1) * lineHeight - editor.scrollTop
    check(row && Math.abs(row.getBoundingClientRect().top - expectedTop) < 1, `line ${bottomLine} must stay aligned after deep scrolling and resizing; rendered ${rows[0]?.textContent}–${rows[rows.length - 1]?.textContent}`)
    check(gutterViewport.clientHeight === editor.clientHeight && rows.length < 100, `gutter must track viewport height and render only nearby line numbers; gutter ${gutterViewport.clientHeight}, editor ${editor.clientHeight}, rows ${rows.length}`)
  }
  check(Math.abs(scrollTop - 700_007) < 1, 'fixture must scroll deep into the draft')
  checkViewport()
  modal.style.height = ''
  // The resize observer reports during layout and React commits its update in the next frame.
  await tick()
  await tick()
  check(editor.clientHeight > shortHeight && editor.scrollTop === scrollTop, 'resizing must reveal more lines at the same scroll offset')
  checkViewport()
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
