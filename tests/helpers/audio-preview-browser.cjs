const { app, BrowserWindow, nativeTheme, protocol } = require('electron')
const assert = require('node:assert/strict')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  // A real PCM WAV exercises Chromium decoding and seek through the custom scheme.
  const sampleRate = 8000
  const frames = sampleRate * 30
  const wav = Buffer.alloc(44 + frames * 2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40)
  for (let i = 0; i < frames; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 1000), 44 + i * 2)
  protocol.handle('remote-preview', (request) => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.get('range') || '')
    const start = range ? Number(range[1]) : 0
    const end = range && range[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1
    const headers = { 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${wav.length}`
    return new Response(wav.subarray(start, end + 1), { status: range ? 206 : 200, headers })
  })
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const server = await createServer({
    configFile: false, plugins: [react(), {
      name: 'audio-preview-fixture', configureServer(server) {
        server.middlewares.use('/__audio_preview_test', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await server.transformIndexHtml('/__audio_preview_test', '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/helpers/audio-preview-fixture.tsx"></script></body></html>'))
        })
      },
    }], server: { host: '127.0.0.1', port: 0, watch: null },
  })
  const window = new BrowserWindow({ show: false, width: 1050, height: 728, webPreferences: { sandbox: true, backgroundThrottling: false } })
  window.webContents.setAudioMuted(true)
  const execute = (code) => window.webContents.executeJavaScript(code)
  const until = async (condition) => {
    const deadline = Date.now() + 8000
    while (!await execute(condition)) {
      if (Date.now() > deadline) throw new Error('Timed out: ' + condition + '\n' + await execute('document.body.innerText'))
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  try {
    await server.listen()
    await window.loadURL(server.resolvedUrls.local[0] + '__audio_preview_test')
    await until('Boolean(document.querySelector("audio")?.currentTime > 0)')
    assert.equal(await execute('document.querySelector("audio").controls'), true)
    assert.equal(await execute('document.querySelector("audio").duration'), 30)
    await execute('document.querySelector("audio").pause(); document.querySelector("audio").currentTime = 2; document.querySelector("audio").focus()')
    // A trusted key on the native controls must seek once, not both natively and via our handler.
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' })
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' })
    await until('document.querySelector("audio").currentTime >= 7')
    assert.equal(await execute('document.querySelector("audio").currentTime'), 7)
    await execute('document.querySelector("audio").currentTime = 18')
    await until('!document.querySelector("audio").seeking')
    assert.equal(await execute('document.querySelector("audio").currentTime'), 18)
    const controls = await execute('document.querySelector("audio").getBoundingClientRect().toJSON()')
    const pointer = (type, fraction, extra = {}) => window.webContents.sendInputEvent({
      type, x: Math.round(controls.x + controls.width * fraction), y: Math.round(controls.y + controls.height / 2), ...extra,
    })
    pointer('mouseDown', .5, { button: 'left', clickCount: 1 })
    pointer('mouseMove', .6, { button: 'left' })
    pointer('mouseMove', .72, { button: 'left' })
    pointer('mouseUp', .72, { button: 'left', clickCount: 1 })
    await until('!document.querySelector("audio").seeking && document.querySelector("audio").currentTime > 20')
    await execute('document.querySelector("audio").play()')
    await until('!document.querySelector("audio").paused')
    await execute('document.getElementById("switch-session").click()')
    await until('document.querySelector("audio").paused')
    const position = await execute('document.querySelector("audio").currentTime')
    await execute('document.getElementById("switch-session").click()')
    await until('Boolean(document.querySelector(".session-workspace-layer.active"))')
    assert.equal(await execute('document.querySelector("audio").paused'), true)
    assert.equal(await execute('document.querySelector("audio").currentTime'), position)
    let layoutChecks = 0
    for (const theme of ['light', 'dark', 'cream']) {
      nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
      await execute(`document.documentElement.dataset.theme = '${theme}'`)
      await until(`matchMedia('(prefers-color-scheme: dark)').matches === ${theme === 'dark'}`)
      for (const [width, height] of [[1050, 728], [820, 530], [640, 480]]) {
        window.setContentSize(width, height)
        for (const expanded of [false, true]) {
          await execute(`document.querySelector('[aria-label="快捷键"]').getAttribute('aria-expanded') !== '${expanded}' && document.querySelector('[aria-label="快捷键"]').click()`)
          // Prime painting in the hidden window before waiting for CSS transitions.
          await window.webContents.capturePage(undefined, { stayHidden: true })
          await new Promise((resolve) => setTimeout(resolve, 400))
          await until(expanded
            ? 'document.querySelector(".ap-shortcuts-panel").clientHeight >= document.querySelector(".ap-shortcuts-groups").scrollHeight - 1'
            : 'document.querySelector(".ap-shortcuts-panel").clientHeight <= 1')
          const failures = await execute(`(${checkLayout.toString()})()`)
          assert.deepEqual(failures, [], `${theme}, ${width}x${height}, expanded=${expanded}: ${failures.join('; ')}`)
          layoutChecks++
          if (process.env.AUDIO_PREVIEW_SCREENSHOT_DIR && width === 1050) {
            mkdirSync(process.env.AUDIO_PREVIEW_SCREENSHOT_DIR, { recursive: true })
            await window.webContents.capturePage(undefined, { stayHidden: true })
            await new Promise((resolve) => setTimeout(resolve, 180))
            writeFileSync(join(process.env.AUDIO_PREVIEW_SCREENSHOT_DIR, `${theme}-${expanded ? 'expanded' : 'collapsed'}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
          }
        }
      }
    }
    await execute('document.querySelector("audio").volume = .4; document.querySelector("audio").playbackRate = 1.5; document.getElementById("reopen").click()')
    await until('document.querySelector("audio").currentTime > 0 && !document.querySelector("audio").paused')
    assert.equal(await execute('document.querySelector("audio").volume'), 1)
    assert.equal(await execute('document.querySelector("audio").playbackRate'), 1)
    assert.equal(await execute('document.querySelector("[aria-label=快捷键]").getAttribute("aria-expanded")'), 'false')
    console.log(`audio browser checks passed (${layoutChecks} layouts, native playback, trusted keyboard seek, native timeline drag, session pause and reset)`)
  } finally {
    window.destroy()
    await server.close()
  }
  app.exit(0)
}).catch((error) => { console.error(error); app.exit(1) })

function checkLayout() {
  const failures = []
  const backdrop = document.querySelector('.ap-overlay').getBoundingClientRect()
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const modal = document.querySelector('.ap-modal')
  const rect = modal.getBoundingClientRect()
  check(rect.top >= backdrop.top && rect.bottom <= backdrop.bottom && rect.left >= backdrop.left && rect.right <= backdrop.right, 'dialog exceeds session bounds')
  const close = document.querySelector('.ap-close')
  const closeRect = close.getBoundingClientRect()
  check(close.contains(document.elementFromPoint(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2)), 'close button is obscured')
  const content = document.querySelector('.ap-content')
  check(content.scrollWidth <= content.clientWidth + 1, 'horizontal content overflow')
  const expanded = document.querySelector('[aria-label="快捷键"]').getAttribute('aria-expanded') === 'true'
  if (expanded) {
    for (const item of document.querySelectorAll('.ap-shortcut-item')) check(item.scrollWidth <= item.clientWidth + 1, 'shortcut text overflows')
  }
  const audio = document.querySelector('audio')
  audio.scrollIntoView({ block: 'nearest' })
  const audioRect = audio.getBoundingClientRect()
  check(audioRect.top >= content.getBoundingClientRect().top && audioRect.bottom <= rect.bottom, 'native controls are unreachable')
  check(getComputedStyle(document.querySelector('.ap-vinyl')).animationPlayState === 'paused', 'paused audio animation is running')
  check(document.querySelector('h2').scrollWidth > document.querySelector('h2').clientWidth, 'long title should be truncated')
  content.scrollTop = 0
  return failures
}
