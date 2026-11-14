const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const directory = process.argv[2]
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-features', 'OverlayScrollbar')

/** Verifies assistant UI interactions and native scrolling in a Chromium window. */
async function verify() {
  const window = new BrowserWindow({ show: false, width: 1100, webPreferences: { backgroundThrottling: false, offscreen: true } })
  const contents = window.webContents
  contents.debugger.attach('1.3')
  await window.loadFile(join(directory, 'index.html'))
  await contents.executeJavaScript('window.verifyAssistantUI()')
  const view = await contents.executeJavaScript('window.prepareAssistantScroll()')
  assert(view.contentHeight > view.height && view.width > view.clientWidth, 'Transcript needs a native scrollbar')
  /** Reads the transcript's live scroll position from the renderer. */
  const state = () => contents.executeJavaScript('window.readAssistantScroll()')
  assert(Math.abs(view.top - (view.contentHeight - view.height)) <= 2, 'Streaming follows at the bottom: ' + JSON.stringify(view))
  /** Dispatches native mouse input at viewport coordinates with the given button or wheel options. */
  const mouse = (type, x, y, options) => contents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x, y, ...options })
  await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  await mouse('mouseWheel', view.x + 40, view.y + view.height / 2, { deltaX: 0, deltaY: -40 })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const afterWheel = await state()
  assert(afterWheel.top < view.top, 'Wheel moves away from the bottom: ' + JSON.stringify({ view, afterWheel }))
  await contents.executeJavaScript('window.growAssistantScroll()')
  assert(Math.abs((await state()).top - afterWheel.top) <= 1, 'Streaming preserves a user scroll near the bottom')
  const scroll = await contents.executeJavaScript(`(() => {
    const view = document.querySelector('.assistant-transcript')
    view.scrollTop = view.scrollHeight
    return window.readAssistantScroll()
  })()`)
  await contents.capturePage(undefined, { stayHidden: true, stayAwake: true })
  const thumb = view.height * view.height / (scroll.end + view.height)
  const thumbCenter = view.y + thumb / 2 + scroll.top / scroll.end * (view.height - thumb)
  const scrollbarX = view.x + view.clientWidth + (view.width - view.clientWidth) / 2
  await mouse('mouseMoved', scrollbarX, thumbCenter)
  await mouse('mousePressed', scrollbarX, thumbCenter, { button: 'left', clickCount: 1 })
  await mouse('mouseMoved', scrollbarX, view.y + 30, { button: 'left', buttons: 1 })
  await new Promise((resolve) => setTimeout(resolve, 120))
  await mouse('mouseReleased', scrollbarX, view.y + 30, { button: 'left', clickCount: 1 })
  const dragged = await state()
  assert(dragged.top < scroll.top - 100, 'Dragging the scrollbar moves through the conversation: ' + JSON.stringify({ view, scroll, dragged, scrollbarX, thumbCenter }))
  contents.debugger.detach()
}

app.whenReady().then(verify).then(() => app.exit(0), (error) => { console.error(error); app.exit(1) })
