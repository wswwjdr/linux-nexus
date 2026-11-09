// Run layout checks in the same Chromium engine that renders the desktop app.
const { app, BrowserWindow, nativeTheme } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs')

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { css, fixtures, treeFixture } = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } })
  await window.loadURL('about:blank')
  const failures = []
  let checks = 0
  if (process.env.THEME_SCREENSHOT_DIR) mkdirSync(process.env.THEME_SCREENSHOT_DIR, { recursive: true })
  for (const theme of ['light', 'dark', 'cream']) {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
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
  if (!failures.length) {
    window.setContentSize(640, 480)
    await window.loadFile(treeFixture)
    await window.webContents.executeJavaScript(`(${checkDirectoryUsage.toString()})(${JSON.stringify(css)})`)
    console.log('directory usage tree checks passed')
  }
  window.destroy()
  app.exit(failures.length ? 1 : 0)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})

function checkLayout({ css, html, scope, theme }) {
  document.documentElement.dataset.theme = theme
  document.head.innerHTML = '<style>' + css + '</style>'
  document.body.innerHTML = scope === 'session'
    ? '<div class="app-shell"><main class="main-area"><header class="topbar"></header><div class="session-tabbar"></div><div class="session-content"><div class="session-workspace-layer active">' + html + '</div></div></main></div>'
    : html
  // The settings fixture models a user who explicitly selected the theme under test.
  document.querySelectorAll('.settings-theme-options button').forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index === ['light', 'dark', 'cream'].indexOf(theme)))
  })
  // Layout reads flush styles synchronously, including in a hidden BrowserWindow.
  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]')
  const backdrop = dialog.parentElement
  const performance = dialog.matches('.performance-popover')
  const area = performance ? { top: 42, left: 0, right: innerWidth, bottom: innerHeight } : backdrop.getBoundingClientRect()
  const padding = performance ? 16 : parseFloat(getComputedStyle(backdrop).paddingTop)
  const errors = []
  const calculate = dialog.querySelector('.file-properties-calculate')
  const contents = dialog.querySelector('.file-properties-directory-contents')
  if ((calculate || contents) && innerWidth <= 640) dialog.style.maxWidth = '320px'
  for (const button of dialog.querySelectorAll('.file-properties-calculate')) {
    const style = getComputedStyle(button)
    if (button.offsetHeight !== 26 || style.paddingLeft !== '8px' || style.paddingRight !== '8px') errors.push('calculate button must use compact dimensions')
    if (button.getBoundingClientRect().right > button.parentElement.getBoundingClientRect().right + 1) errors.push('calculate button exceeds available width')
  }
  if (contents) {
    if (contents.scrollWidth > contents.clientWidth) errors.push('directory counts overflow horizontally')
    if (innerWidth <= 640 && contents.offsetHeight <= parseFloat(getComputedStyle(contents).lineHeight)) errors.push('directory counts must wrap in a narrow dialog')
  }
  const fits = (element, label) => {
    const rect = element.getBoundingClientRect()
    if (rect.top < area.top + padding - 1 || rect.bottom > Math.min(area.bottom, innerHeight) - padding + 1
      || rect.left < area.left + padding - 1 || rect.right > Math.min(area.right, innerWidth) - padding + 1) {
      errors.push(label + ' exceeds available bounds: ' + JSON.stringify(rect.toJSON()))
    }
  }
  fits(dialog, 'dialog')
  const heading = dialog.querySelector('.modal-heading, .ap-header, .confirmation-heading, .search-dialog-header, .session-launcher-header, .performance-popover-header')
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
  for (const selector of ['.settings-form-content', '.shortcut-guide-groups', '.md-viewport', '.log-preview-text', '.script-execution-output', '.search-controls', '.search-results-panel']) {
    const panel = dialog.querySelector(selector)
    if (panel && panel.clientHeight < 40) errors.push(selector + ' has no usable viewport')
  }
  return errors
}

async function checkDirectoryUsage(css) {
  document.head.appendChild(document.createElement('style')).textContent = css
  const check = (condition, description) => { if (!condition) throw new Error(description) }
  const until = async (predicate, description) => {
    for (let i = 0; i < 160; i++) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(description)
  }
  for (const [locale, name, size] of [['zh-CN', '名称', '占用空间'], ['en', 'Name', 'Disk usage']]) {
    window.openTreeFixture(locale)
    const button = () => document.querySelector('.file-properties-disk-usage button:last-child')
    await until(button, 'The detailed usage button did not appear')
    button().click()
    const viewport = () => document.querySelector('[role="tree"]')
    const rows = () => [...viewport().querySelectorAll('[role="treeitem"]')]
    const row = title => rows().find(item => item.querySelector('bdi').textContent === title)
    await until(() => viewport() && row('folder'), 'The detailed usage tree did not render')
    const dialog = viewport().closest('[role="dialog"]')
    dialog.style.maxWidth = '360px'
    const header = [...dialog.querySelector('.directory-usage-columns').children].map(element => element.textContent)
    check(header.join('|') === name + '|' + size, 'The usage column headings are incorrect')
    check(viewport().clientHeight > 80 && viewport().scrollWidth <= viewport().clientWidth, 'The tree must fit a narrow dialog')
    check(Math.abs(dialog.querySelector('.directory-usage-columns > :last-child').getBoundingClientRect().right -
      row('folder').querySelector('.directory-usage-size').getBoundingClientRect().right) <= 1, 'Size column is not aligned with its heading')
    check(rows().length < 80 && rows()[1] === row('folder') && !row('nested'), 'The tree must render sorted, expanded-root rows only')
    check(row('a shared file').querySelector('.directory-usage-shared'), 'The shared allocation marker is missing')
    const key = value => viewport().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))
    viewport().focus()
    key('ArrowRight')
    await until(() => row('folder').dataset.active === 'true', 'ArrowRight did not move into the root')
    key('ArrowRight')
    await until(() => row('nested'), 'Keyboard expansion did not show the nested row')
    key('ArrowLeft')
    await until(() => !row('nested'), 'Keyboard collapse did not hide the nested row')
    row('folder').click()
    await until(() => row('nested'), 'Mouse expansion did not show the nested row')
    key('End')
    const lastFile = locale === 'en' ? 'file-499996' : 'file-99996'
    await until(() => row(lastFile)?.dataset.active === 'true', 'The last descendant was not reachable')
    check(rows().length < 80, 'The virtual tree rendered too many rows')
  }
}
