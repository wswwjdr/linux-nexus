const { app, BrowserWindow, nativeTheme, protocol } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
require('tsx/cjs')
const { registerPreviewProtocol } = require('../../src/main/preview-protocol.ts')
const { registerLocalPreviewAsset, clearPreviewAssets } = require('../../src/main/previews/preview-assets.ts')

protocol.registerSchemesAsPrivileged([{ scheme: 'remote-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-rich-preview-'))
  const window = new BrowserWindow({ show: false, width: 1050, height: 728, webPreferences: { sandbox: true, backgroundThrottling: false } })
  window.webContents.setAudioMuted(true)
  const execute = (code) => window.webContents.executeJavaScript(code, true)
  const until = async (condition) => {
    const deadline = Date.now() + 8000
    while (!await execute(condition)) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + condition + '\n' + await execute('JSON.stringify({text:document.body.innerText,video:document.querySelector("video") && {paused:document.querySelector("video").paused,ready:document.querySelector("video").readyState,time:document.querySelector("video").currentTime,src:document.querySelector("video").currentSrc,error:document.querySelector("video").error},active:!!document.querySelector(".session-workspace-layer.active")})'))
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
  }
  const key = (keyCode, type = 'keyDown') => window.webContents.sendInputEvent({ type, keyCode })
  const click = async (selector) => execute(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const screenshot = async (name) => {
    if (!process.env.RICH_PREVIEW_SCREENSHOT_DIR) return
    mkdirSync(process.env.RICH_PREVIEW_SCREENSHOT_DIR, { recursive: true })
    await window.webContents.capturePage(undefined, { stayHidden: true })
    await new Promise((resolve) => setTimeout(resolve, 200))
    writeFileSync(join(process.env.RICH_PREVIEW_SCREENSHOT_DIR, name + '.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
  }
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const server = await createServer({ configFile: false, resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } }, plugins: [react(), {
    name: 'rich-preview-fixture', configureServer(server) {
      server.middlewares.use('/__fixture_image.svg', (_request, response) => {
        response.setHeader('Content-Type', 'image/svg+xml')
        response.end(require('node:fs').readFileSync(join(directory, 'fixture.svg')))
      })
      server.middlewares.use('/__rich_preview_test', async (_request, response) => {
        response.setHeader('Content-Type', 'text/html')
        response.end(await server.transformIndexHtml('/__rich_preview_test', '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/helpers/rich-previews-fixture.tsx"></script></body></html>'))
      })
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null } })
  try {
    await window.loadURL('data:text/html,<canvas width="320" height="180" id="canvas"></canvas>')
    const bytes = await execute(`(async () => {
      const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
      ctx.fillStyle = '#5e5ce6'; ctx.fillRect(0,0,320,180);
      const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
      const done = new Promise(resolve => recorder.onstop = resolve); recorder.start();
      let frame = 0;
      const timer = setInterval(() => { ctx.fillStyle = '#5e5ce6'; ctx.fillRect(0,0,320,180); ctx.fillStyle = 'white'; ctx.font = '24px sans-serif'; ctx.fillText('Linux Nexus ' + frame++, 40, 95); }, 100);
      await new Promise(resolve => setTimeout(resolve, 6400)); clearInterval(timer); recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    })()`)
    const video = addWebmDuration(Buffer.from(bytes), 6400)
    const videoPath = join(directory, 'fixture.webm'), imagePath = join(directory, 'fixture.svg')
    writeFileSync(videoPath, video)
    writeFileSync(imagePath, '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><defs><linearGradient id="g"><stop stop-color="#007aff"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="800" cy="480" r="230" fill="#ffffff22"/><text x="800" y="520" text-anchor="middle" font-family="sans-serif" font-size="100" fill="white">Linux Nexus</text></svg>')
    registerLocalPreviewAsset('video', videoPath, 'video/webm')
    registerLocalPreviewAsset('image', imagePath, 'image/svg+xml')
    registerPreviewProtocol()
    await server.listen()
    await window.loadURL(server.resolvedUrls.local[0] + '__rich_preview_test')
    await until('Boolean(document.querySelector(".md-article .hljs-keyword"))')
    await until('Boolean(document.querySelector(".md-article img")?.naturalWidth)')
    assert.equal(await execute('document.querySelector(".md-article").getBoundingClientRect().width <= 960'), true)
    await click('[aria-label="目录"]')
    await execute('document.querySelectorAll(".md-catalog button")[20].click()')
    await until('document.querySelector(".md-viewport").scrollTop > 500')
    const scroll = await execute('document.querySelector(".md-viewport").scrollTop')
    await click('#switch-session'); await until('!document.querySelector(".session-workspace-layer.active")')
    await click('#switch-session'); await until('Boolean(document.querySelector(".session-workspace-layer.active"))')
    assert.equal(await execute('document.querySelector(".md-viewport").scrollTop'), scroll)
    await execute('document.querySelector(".md-viewport").scrollTop = 0')
    await screenshot('markdown')
    await execute('window.fixtureOpen("image")')
    await until('Boolean(document.querySelector(".ip-image")?.naturalWidth)')
    await click('[aria-label="放大"]')
    assert.equal(await execute('document.querySelector(".ip-scale").textContent'), '115%')
    await click('[aria-label="顺时针旋转"]'); await click('[aria-label="水平翻转"]')
    assert.match(await execute('document.querySelector(".ip-image").style.transform'), /rotate\(90deg\) scale\(-1, 1\)/)
    const viewport = await execute('document.querySelector(".ip-viewport").getBoundingClientRect().toJSON()')
    const x = Math.round(viewport.x + viewport.width / 2), y = Math.round(viewport.y + viewport.height / 2)
    window.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseMove', x: x + 80, y: y + 30, button: 'left' })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: x + 80, y: y + 30, button: 'left', clickCount: 1 })
    await until('document.querySelector(".ip-translation").style.transform.includes("80px, 30px")')
    await click('[aria-label="适应窗口"]')
    assert.equal(await execute('document.querySelector(".ip-scale").textContent'), '100%')
    assert.match(await execute('document.querySelector(".ip-image").style.transform'), /rotate\(90deg\)/)
    await screenshot('image')
    await execute('window.fixtureOpen("video")')
    await until('Boolean(document.querySelector("video"))')
    await until('Boolean(document.querySelector("video")?.currentTime > 0)')
    assert.equal(await execute('document.querySelector(".video-js").classList.contains("vjs-playing")'), true)
    await execute('document.querySelector("video").pause(); document.querySelector("video").currentTime = .3; document.querySelector(".vp-modal").focus()')
    key('Right'); key('Right', 'keyUp')
    await until('document.querySelector("video").currentTime > 5')
    assert.ok(Math.abs(await execute('document.querySelector("video").currentTime') - 5.3) < .1)
    const progress = await execute('document.querySelector(".vjs-progress-holder").getBoundingClientRect().toJSON()')
    const pointer = (type, fraction) => window.webContents.sendInputEvent({ type,
      x: Math.round(progress.x + progress.width * fraction), y: Math.round(progress.y + progress.height / 2), button: 'left', clickCount: 1,
      modifiers: type === 'mouseUp' ? [] : ['leftButtonDown'] })
    pointer('mouseDown', .2)
    await new Promise((resolve) => setTimeout(resolve, 80))
    pointer('mouseMove', .5)
    await new Promise((resolve) => setTimeout(resolve, 80))
    pointer('mouseUp', .5)
    await until('document.querySelector("video").currentTime > 2 && document.querySelector("video").currentTime < 4')
    await execute('document.querySelector(".vp-modal").focus()')
    await execute('document.querySelector("video").playbackRate = 1.5')
    key('Right'); await new Promise((resolve) => setTimeout(resolve, 600))
    assert.equal(await execute('document.querySelector("video").playbackRate'), 2)
    key('Right', 'keyUp')
    await until('document.querySelector("video").playbackRate === 1.5')
    await execute('document.querySelector("video").currentTime = 1; document.querySelector("video").play()')
    await click('#switch-session')
    await until('document.querySelector("video").paused')
    const time = await execute('document.querySelector("video").currentTime')
    await click('#switch-session')
    await until('Boolean(document.querySelector(".session-workspace-layer.active"))')
    assert.equal(await execute('document.querySelector("video").paused'), true)
    assert.equal(await execute('document.querySelector("video").currentTime'), time)
    await execute('document.querySelector(".vp-modal").focus()')
    key('F'); key('F', 'keyUp')
    await until('Boolean(document.fullscreenElement)')
    key('Escape'); key('Escape', 'keyUp')
    await until('!document.fullscreenElement')
    assert.equal(await execute('Boolean(document.querySelector("video"))'), true)
    await new Promise((resolve) => setTimeout(resolve, 180))
    key('Escape'); key('Escape', 'keyUp')
    await until('!document.querySelector(".vp-modal")')
    let layouts = 0
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme
      for (const [width, height] of [[1050, 728], [640, 480]]) {
        window.setContentSize(width, height)
        for (const kind of ['video', 'image', 'markdown']) {
          await execute(`window.fixtureOpen('${kind}')`)
          await until(`Boolean(document.querySelector('.${kind === 'video' ? 'vp-modal' : kind === 'image' ? 'ip-dialog' : 'md-dialog'}'))`)
          if (kind === 'video') { await until('Boolean(document.querySelector("video"))'); await execute('document.querySelector("video").pause()'); await click('[aria-label="快捷键"]') }
          if (kind === 'markdown') await click('[aria-label="目录"]')
          await window.webContents.capturePage(undefined, { stayHidden: true })
          await new Promise((resolve) => setTimeout(resolve, 400))
          assert.deepEqual(await execute(`(${checkLayout.toString()})()`), [], `${theme} ${kind} ${width}x${height}`)
          layouts++
          if (width === 1050) await screenshot(`${theme}-${kind}`)
        }
      }
    }
    await execute(`window.originalMediaPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function() { return Promise.reject(new DOMException('blocked for test', 'NotAllowedError')); };
      window.fixtureOpen('video')`)
    await until('Boolean(document.querySelector(".vp-notice"))')
    assert.match(await execute('document.querySelector(".vp-notice").textContent'), /自动播放被阻止/)
    assert.equal(await execute('document.querySelector("video").muted'), false)
    await execute('HTMLMediaElement.prototype.play = window.originalMediaPlay; document.querySelector(".vp-modal").focus()')
    key('K'); key('K', 'keyUp')
    await until('!document.querySelector("video").paused')
    assert.equal(await execute('document.querySelector(".vp-notice")'), null)
    console.log(`rich preview browser checks passed (${layouts} layouts, video playback/fullscreen/long-press/session pause, pointer image transforms, Markdown catalog)`)
  } finally {
    window.destroy(); clearPreviewAssets(); await server.close(); rmSync(directory, { recursive: true, force: true })
  }
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })

function checkLayout() {
  const failures = [], dialog = document.querySelector('[role="dialog"]'), backdrop = dialog.parentElement
  const area = backdrop.getBoundingClientRect(), rect = dialog.getBoundingClientRect()
  if (rect.top < area.top - 1 || rect.bottom > area.bottom + 1 || rect.left < area.left - 1 || rect.right > area.right + 1) failures.push('dialog exceeds workspace')
  const close = dialog.querySelector('.ap-close, .ip-close'), button = close.getBoundingClientRect()
  if (!close.contains(document.elementFromPoint(button.x + button.width / 2, button.y + button.height / 2))) failures.push('close is obscured')
  const toolbar = dialog.querySelector('.ip-toolbar')
  if (toolbar && toolbar.scrollWidth > toolbar.clientWidth + 1) failures.push('toolbar overflows')
  const content = dialog.querySelector('.vp-content, .md-viewport')
  if (content && content.scrollWidth > content.clientWidth + 1) failures.push('content overflows horizontally')
  const controls = dialog.querySelector('.vjs-control-bar')
  if (controls && controls.getBoundingClientRect().bottom > rect.bottom + 1) failures.push('video controls are clipped')
  return failures
}

function addWebmDuration(buffer, milliseconds) {
  const index = buffer.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]))
  assert.ok(index >= 0, 'WebM info element missing')
  const offset = index + 4, length = Math.clz32(buffer[offset]) - 24 + 1
  let size = buffer[offset] & (0xff >> length)
  for (let i = 1; i < length; i++) size = size * 256 + buffer[offset + i]
  const duration = Buffer.alloc(11); duration.set([0x44, 0x89, 0x88]); duration.writeDoubleBE(milliseconds, 3)
  const encoded = Buffer.alloc(length)
  let next = size + duration.length
  for (let i = length - 1; i >= 0; i--) { encoded[i] = next & 255; next = Math.floor(next / 256) }
  assert.equal(next, 0); encoded[0] |= 1 << (8 - length)
  return Buffer.concat([buffer.subarray(0, offset), encoded, buffer.subarray(offset + length, offset + length + size), duration, buffer.subarray(offset + length + size)])
}
