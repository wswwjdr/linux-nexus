// Run layout checks in the same Chromium engine that renders the desktop app.
const { app, BrowserWindow, nativeTheme } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { css, fixtures } = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } })
  await window.loadURL('about:blank')
  const failures = []
  let checks = 0
  if (process.env.THEME_SCREENSHOT_DIR) mkdirSync(process.env.THEME_SCREENSHOT_DIR, { recursive: true })
  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme
    for (const [width, height] of [[1440, 900], [1050, 728], [820, 530], [640, 480]]) {
      window.setContentSize(width, height)
      for (const scope of ['window', 'session']) {
        for (const fixture of fixtures) {
          if (scope === 'session' && ['session chooser', 'performance'].includes(fixture.name)) continue
          const errors = await window.webContents.executeJavaScript(`(${checkLayout.toString()})(${JSON.stringify({ css, html: fixture.html, scope, theme })})`)
          checks++
          failures.push(...errors.map((error) => `${theme}, ${fixture.name}, ${scope}, ${width}x${height}: ${error}`))
          if (process.env.THEME_SCREENSHOT_DIR && (scope === 'session' || fixture.name === 'performance') && width === 1050) {
            await window.webContents.capturePage(undefined, { stayHidden: true })
            await new Promise((resolve) => setTimeout(resolve, 180))
            writeFileSync(require('node:path').join(process.env.THEME_SCREENSHOT_DIR, `${theme}-${fixture.name.replaceAll(' ', '-')}.png`), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
          }
          if (process.env.LAYOUT_SCREENSHOT_PATH && fixture.name === (process.env.LAYOUT_SCREENSHOT_FIXTURE || 'text') && scope === 'session' && width === 1050) {
            await window.webContents.capturePage(undefined, { stayHidden: true })
            await new Promise((resolve) => setTimeout(resolve, 100))
            writeFileSync(process.env.LAYOUT_SCREENSHOT_PATH, (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
          }
        }
      }
    }
  }
  console.log(JSON.stringify({ checks, failures }))
  window.destroy()
  app.exit(failures.length ? 1 : 0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

function checkLayout({ css, html, scope, theme }) {
  document.head.innerHTML = '<style>' + css + '</style>'
  document.body.innerHTML = scope === 'session'
    ? '<div class="app-shell"><main class="main-area"><header class="topbar"></header><div class="session-tabbar"></div><div class="session-content"><div class="session-workspace-layer active">' + html + '</div></div></main></div>'
    : html
  // The settings fixture models a user who explicitly selected the theme under test.
  document.querySelectorAll('.settings-theme-options button').forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index === (theme === 'dark' ? 1 : 0)))
  })
  // Layout reads flush styles synchronously, including in a hidden BrowserWindow.
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
  const backdrop = dialog.parentElement
  const performance = dialog.matches('.performance-popover')
  const area = performance ? { top: 42, left: 0, right: innerWidth, bottom: innerHeight } : backdrop.getBoundingClientRect()
  const padding = performance ? 16 : parseFloat(getComputedStyle(backdrop).paddingTop)
  const errors = []
  const fits = (element, label) => {
    const rect = element.getBoundingClientRect()
    if (rect.top < area.top + padding - 1 || rect.bottom > Math.min(area.bottom, innerHeight) - padding + 1
      || rect.left < area.left + padding - 1 || rect.right > Math.min(area.right, innerWidth) - padding + 1) {
      errors.push(label + ' exceeds available bounds: ' + JSON.stringify(rect.toJSON()))
    }
  }
  fits(dialog, 'dialog')
  const heading = dialog.querySelector('.modal-heading, .confirmation-heading, .search-dialog-header, .session-launcher-header, .performance-popover-header')
  if (heading) fits(heading, 'heading')
  const editor = dialog.querySelector('.text-preview-editor')
  if (editor && (editor.clientHeight < 80 || editor.scrollHeight <= editor.clientHeight)) errors.push('text editor must have a usable, scrollable viewport')
  const footer = dialog.querySelector('.text-preview-footer, .modal-footer, .session-launcher-actions')
  if (footer) {
    // Content panels should shrink first so text/save and output/stop remain visible.
    if (dialog.matches('.text-preview-modal, .script-execution-modal')) fits(footer, 'fixed footer')
    footer.scrollIntoView({ block: 'nearest' })
    fits(footer, 'reachable footer')
    const button = footer.querySelector('button:last-child')
    const rect = button.getBoundingClientRect()
    if (!button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) errors.push('footer action is obscured')
  }
  for (const selector of ['.settings-form-content', '.shortcut-guide-groups', '.preview-markdown', '.log-preview-text', '.script-execution-output', '.search-controls', '.search-results-panel']) {
    const panel = dialog.querySelector(selector)
    if (panel && panel.clientHeight < 40) errors.push(selector + ' has no usable viewport')
  }
  return errors
}
