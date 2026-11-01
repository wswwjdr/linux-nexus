const { app, BrowserWindow, nativeTheme } = require('electron')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const directory = mkdtempSync(join(tmpdir(), 'nexus-theme-'))
  const server = await createServer({
    configFile: false,
    cacheDir: join(directory, 'node_modules', '.vite'),
    optimizeDeps: { include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'react/jsx-runtime', '@xterm/xterm', '@xterm/addon-fit', 'lucide-react'] },
    resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
    plugins: [react(), {
      name: 'theme-test-page',
      configureServer(server) {
        server.middlewares.use('/__theme_test', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html')
          response.end(await server.transformIndexHtml('/__theme_test', '<html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/tests/helpers/theme-fixture.tsx"></script></body></html>'))
        })
      },
    }],
    server: { host: '127.0.0.1', port: 0, watch: null },
  })
  const preload = join(directory, 'preload.cjs')
  writeFileSync(preload, `const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('settingsApi', {
      getAppSettings: () => ipcRenderer.invoke('settings:get'),
      updateAppSettings: patch => ipcRenderer.invoke('settings:update', patch),
    });`)
  const window = new BrowserWindow({ show: false, width: 1160, height: 760, webPreferences: { preload, sandbox: true, backgroundThrottling: false } })
  const originalSource = nativeTheme.themeSource
  let main
  window.webContents.on('console-message', details => {
    if (details.level === 'error') console.error(details.message)
  })
  try {
    await server.listen()
    // Load the production main-process modules, with actual Electron APIs and isolated settings.
    const mainBundle = join(directory, 'main.cjs')
    await require('esbuild').build({
      stdin: { contents: "export { registerSettingsIpc } from './src/main/ipc/settings'; export * from './src/main/theme'; export * from './src/main/runtime'; export { configureStateFiles, readAppSettings, writeAppSettings } from './src/main/state-store'", resolveDir: process.cwd() },
      bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: mainBundle,
      alias: { '@shared': resolve('src/shared') },
    })
    const theme = require(mainBundle)
    main = theme
    const runtime = theme
    const store = theme
    runtime.setMainWindow(window)
    store.configureStateFiles(join(directory, 'servers.json'), join(directory, 'settings.json'))
    assert.equal(store.readAppSettings().theme, 'light')
    // Migrate only valid legacy settings, preserving every other preference.
    const settingsPath = join(directory, 'settings.json')
    const legacy = { ...store.readAppSettings(), theme: 'system', textMiB: 17 }
    writeFileSync(settingsPath, JSON.stringify(legacy))
    assert.deepEqual(store.readAppSettings(), { ...legacy, theme: 'light' })
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, 'utf8')), { ...legacy, theme: 'light' })
    assert.equal(store.readAppSettings().textMiB, 17)
    for (const invalid of [{ ...legacy, textMiB: 0 }, { ...legacy, theme: 'unknown' }]) {
      const contents = JSON.stringify(invalid)
      writeFileSync(settingsPath, contents)
      assert.throws(() => store.readAppSettings())
      assert.equal(readFileSync(settingsPath, 'utf8'), contents)
    }
    store.writeAppSettings({ ...legacy, theme: 'light' })
    assert.throws(() => store.writeAppSettings(legacy))
    theme.registerSettingsIpc()
    theme.applyTheme('light')
    await window.loadURL(server.resolvedUrls.local[0] + '__theme_test')
    const js = source => window.webContents.executeJavaScript(source)
    const tick = () => new Promise(resolve => setTimeout(resolve, 180))
    const waitFor = async source => {
      for (let i = 0; i < 200; i++) {
        if (await js(source)) return
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      throw new Error('Fixture did not become ready: ' + source)
    }
    await waitFor('Boolean(window.showScene && window.settingsLoaded)')
    window.webContents.debugger.attach('1.3')
    const devtools = (command, params) => window.webContents.debugger.sendCommand(command, params)
    await devtools('DOM.enable')
    await devtools('CSS.enable')
    const forceState = async (selector, forcedPseudoClasses) => {
      const { root } = await devtools('DOM.getDocument')
      const { nodeId } = await devtools('DOM.querySelector', { nodeId: root.nodeId, selector })
      await devtools('CSS.forcePseudoState', { nodeId, forcedPseudoClasses })
      await tick()
    }
    const screenshots = process.env.THEME_SCREENSHOT_DIR
    if (screenshots) mkdirSync(screenshots, { recursive: true })
    const backgrounds = { light: '#f2f2f2', dark: '#111111', cream: '#f6f1e7' }
    const chooseTheme = async mode => {
      await js('window.openSettings()')
      await waitFor('Boolean(document.querySelector(".settings-theme-options"))')
      assert.deepEqual(await js('Array.from(document.querySelectorAll(".settings-theme-options button"), button => button.textContent.trim())'), ['银砂白', '石墨黑', '米白'])
      await js(`document.querySelectorAll('.settings-theme-options button')[${['light', 'dark', 'cream'].indexOf(mode)}].click()`)
      await waitFor(`document.documentElement.dataset.theme === '${mode}'`)
    }
    for (const mode of ['light', 'dark', 'cream']) {
      await chooseTheme(mode)
      await tick()
      assert.equal(await js('document.querySelectorAll(".settings-theme-options button[aria-pressed=true]").length'), 1)
      assert.deepEqual(await js(`(${checkTheme.toString()})()`), [], `${mode}/settings`)
      if (screenshots) {
        // Reopen after switching to avoid stale composited controls in hidden-window captures.
        await js('document.querySelector("[aria-label=关闭设置]").click()')
        await waitFor('!document.querySelector(".settings-theme-options")')
        await js('window.openSettings()')
        await waitFor('Boolean(document.querySelector(".settings-theme-options"))')
        await devtools('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
        assert.equal(await js('getComputedStyle(document.querySelector(".settings-theme-options [aria-pressed=true]")).backgroundColor'), {
          light: 'rgb(225, 225, 225)', dark: 'rgb(43, 43, 43)', cream: 'rgb(226, 217, 200)',
        }[mode])
        await window.webContents.capturePage(undefined, { stayHidden: true })
        await tick()
        writeFileSync(join(screenshots, `${mode}-settings.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
        await devtools('Emulation.setEmulatedMedia', { features: [] })
      }
      await js('document.querySelector("[aria-label=关闭设置]").click()')
      assert.equal(JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')).theme, mode)
      assert.equal(store.readAppSettings().theme, mode)
      await tick()
      assert.equal(window.getBackgroundColor().toLowerCase(), backgrounds[mode])
      assert.equal(await js('matchMedia("(prefers-color-scheme: dark)").matches'), mode === 'dark')
      nativeTheme.emit('updated')
      await tick()
      assert.equal(nativeTheme.themeSource, mode === 'dark' ? 'dark' : 'light')
      assert.equal(window.getBackgroundColor().toLowerCase(), backgrounds[mode])
      for (const scene of ['home', 'files', 'grid', 'menu', 'feedback', 'performance-ready', 'terminal']) {
        await js(`window.showScene(${JSON.stringify(scene)})`)
        await tick()
        if (scene === 'terminal') {
          await waitFor('Boolean(window.terminal && window.outputSubscriptions === 1)')
          await js(`new Promise(resolve => window.terminal.write('deploy@nexus:~$ systemctl status nexus\\r\\n\\x1b[32m● nexus.service — Active (running)\\x1b[0m\\r\\nCPU 3.2%   Memory 248 MiB\\r\\n', resolve))`)
        }
        assert.deepEqual(await js(`(${checkTheme.toString()})()`), [], `${mode}/${scene}`)
        if (scene === 'grid') assert.equal(await js('Boolean(document.querySelector(".file-icon-grid"))'), true)
        if (scene === 'files') {
          // Hidden Chromium windows do not advance paint-driven transitions without capturePage.
          // Check the final interactive states with motion disabled, independently of screenshots.
          await devtools('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
          const background = await js('getComputedStyle(document.querySelector("#enabled")).backgroundColor')
          await forceState('#enabled', ['hover'])
          assert.notEqual(await js('getComputedStyle(document.querySelector("#enabled")).backgroundColor'), background)
          await forceState('#enabled', ['focus-visible'])
          assert.equal(await js('getComputedStyle(document.querySelector("#enabled")).outlineStyle'), 'solid')
          // Chromium rounds outlines to physical pixels at fractional Windows scaling.
          assert.ok(await js('parseFloat(getComputedStyle(document.querySelector("#enabled")).outlineWidth) * devicePixelRatio >= 2'))
          await forceState('#enabled', [])
          const disabled = await js('getComputedStyle(document.querySelector("#disabled")).backgroundColor')
          await forceState('#disabled', ['hover'])
          assert.equal(await js('getComputedStyle(document.querySelector("#disabled")).backgroundColor'), disabled)
          await forceState('#disabled', [])
          await devtools('Emulation.setEmulatedMedia', { features: [] })
        }
        if (screenshots) {
          await window.webContents.capturePage(undefined, { stayHidden: true })
          await tick()
          writeFileSync(join(screenshots, `${mode}-${scene}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
        }
      }
      // A theme change must leave the actual xterm instance, buffer and output subscription alive.
      await js('window.originalTerminal = window.terminal; window.originalScreen = document.querySelector(".xterm-screen"); window.terminal.scrollToTop()')
      const buffer = await js('window.terminal.buffer.active.length')
      const scroll = await js('window.terminal.buffer.active.viewportY')
      await chooseTheme(mode === 'light' ? 'dark' : 'light')
      await js('document.querySelector("[aria-label=关闭设置]").click()')
      await tick()
      assert.equal(await js('window.terminal === window.originalTerminal && document.querySelector(".xterm-screen") === window.originalScreen && window.outputSubscriptions === 1'), true)
      assert.equal(await js('window.terminal.buffer.active.length'), buffer)
      assert.equal(await js('window.terminal.buffer.active.viewportY'), scroll)
      assert.equal(await js('window.terminal.options.theme.background'), '#0b0b0b')
      await js('window.terminal.input("pwd\\r")')
      assert.deepEqual(await js('window.terminalWrites.slice(-1)'), ['pwd\r'])
    }
    // Failed saves restore the selected option without changing the rendered palette.
    await chooseTheme('cream')
    await js('window.rejectSettingsSave = true; document.querySelectorAll(".settings-theme-options button")[1].click()')
    await waitFor('Boolean(window.lastToast && document.querySelectorAll(".settings-theme-options button")[2].getAttribute("aria-pressed") === "true")')
    assert.equal(await js('document.documentElement.dataset.theme'), 'cream')
    assert.equal(store.readAppSettings().theme, 'cream')
    await js('window.rejectSettingsSave = false; document.querySelector("[aria-label=关闭设置]").click()')
    await assert.rejects(js('window.settingsApi.updateAppSettings({ theme: "system" })'))
    // Restart the main theme module and reload the renderer using the persisted settings.
    delete require.cache[require.resolve(mainBundle)]
    const restarted = require(mainBundle)
    restarted.configureStateFiles(join(directory, 'servers.json'), join(directory, 'settings.json'))
    restarted.setMainWindow(window)
    restarted.applyTheme(restarted.readAppSettings().theme)
    await window.reload()
    await waitFor('Boolean(window.settingsLoaded) && document.documentElement.dataset.theme === "cream"')
    assert.equal(window.getBackgroundColor().toLowerCase(), backgrounds.cream)
    nativeTheme.emit('updated')
    await tick()
    assert.equal(nativeTheme.themeSource, 'light')
    assert.equal(await js('document.documentElement.dataset.theme'), 'cream')
    assert.equal(window.getBackgroundColor().toLowerCase(), backgrounds.cream)
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    await js('window.showScene("files")')
    await tick()
    assert.equal(await js('getComputedStyle(document.querySelector("button")).transitionDuration'), '0s')
    console.log('theme browser checks passed')
  } finally {
    main?.setMainWindow(null)
    nativeTheme.themeSource = originalSource
    window.destroy()
    await server.close()
    rmSync(directory, { recursive: true, force: true })
  }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })

function checkTheme() {
  const failures = []
  const style = getComputedStyle(document.documentElement)
  const token = name => style.getPropertyValue('--' + name).trim()
  const cream = document.documentElement.dataset.theme === 'cream'
  const neutralTokens = [
    'canvas', 'surface', 'surface-soft', 'surface-raised', 'surface-hover', 'surface-selected', 'surface-selected-strong',
    'text-strong', 'text-primary', 'text-secondary', 'text-subtle', 'text-accent', 'text-info',
    'accent', 'border-accent', 'action-primary', 'action-primary-hover', 'text-on-accent',
    'line', 'line-strong', 'border-info', 'surface-info', 'focus-outline', 'focus-surface', 'surface-output', 'surface-media',
    'terminal-background', 'terminal-foreground', 'terminal-muted', 'terminal-cursor', 'terminal-selection-background',
  ]
  for (const name of neutralTokens.filter(name => !cream || name.startsWith('terminal-') || name === 'text-on-accent')) {
    const channels = token(name).match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i)
    if (!channels || channels[1] !== channels[2] || channels[2] !== channels[3]) failures.push(`${name} is not neutral: ${token(name)}`)
  }
  const base = getComputedStyle(document.querySelector('.main-area')).backgroundColor
  const expected = cream ? 'rgb(246, 241, 231)' : matchMedia('(prefers-color-scheme: dark)').matches ? 'rgb(17, 17, 17)' : 'rgb(242, 242, 242)'
  if (base !== expected) failures.push(`Unexpected main background: ${base}`)
  for (const selector of ['.topbar', '.session-tabbar', '.main-area']) {
    const surface = getComputedStyle(document.querySelector(selector))
    if (surface.backgroundColor !== base || surface.backgroundImage !== 'none') failures.push(`${selector} does not share the flat application background`)
  }
  const luminance = hex => {
    const rgb = hex.replace('#', '').match(/../g).map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  const contrast = (a, b) => {
    const [low, high] = [luminance(a), luminance(b)].sort((a, b) => a - b)
    return (high + .05) / (low + .05)
  }
  const pairs = [
    ...['text-strong', 'text-primary', 'text-secondary', 'text-subtle'].flatMap(text => ['surface', 'surface-raised', 'surface-output', 'surface-soft', 'surface-hover'].map(background => [text, background, 4.5])),
    ['text-accent', 'surface-selected-strong', 4.5], ['text-on-accent', 'action-primary', 4.5], ['text-on-accent', 'action-primary-hover', 4.5],
    ['text-inverse', 'action-danger', 4.5], ['text-inverse', 'action-danger-hover', 4.5], ['text-inverse', 'action-warning', 4.5], ['text-inverse', 'action-warning-hover', 4.5],
    ['text-danger', 'surface-danger', 4.5], ['text-warning', 'surface-warning', 4.5], ['text-success', 'surface-success', 4.5],
    ['focus-outline', 'surface', 3], ['line-strong', 'surface', 3], ['focus-outline', 'surface-selected', 3],
    ['terminal-foreground', 'terminal-background', 4.5], ['terminal-muted', 'terminal-background', 4.5],
  ]
  for (const [foreground, background, minimum] of pairs) {
    const ratio = contrast(token(foreground), token(background))
    if (ratio < minimum) failures.push(`${foreground}/${background}: ${ratio.toFixed(2)} < ${minimum}`)
  }
  const selected = document.querySelector('.file-row.selected')
  if (selected && getComputedStyle(selected).backgroundColor === getComputedStyle(document.querySelector('.file-row:not(.selected)')).backgroundColor) failures.push('Selection is indistinguishable')
  const disabled = document.querySelector('#disabled')
  if (disabled && (getComputedStyle(disabled).cursor !== 'not-allowed' || getComputedStyle(disabled).opacity !== '0.45')) failures.push('Disabled control has no distinct state')
  if (document.querySelector('.terminal-host') && getComputedStyle(document.querySelector('.terminal-host')).backgroundColor !== 'rgb(11, 11, 11)') failures.push('SSH background changed with theme')
  return failures
}
