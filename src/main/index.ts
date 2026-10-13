import { app, BrowserWindow, dialog, protocol } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { stopAllSessions } from './connections'
import { registerIpc } from './ipc'
import { registerPreviewProtocol } from './preview-protocol'
import { getMainWindow, messageFromError, previewAssets, setMainWindow } from './runtime'
import { configureStateFiles, readPreviewLimits, readState } from './state-store'

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let focusWindowWhenCreated = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
}

function focusMainWindow(): void {
  const window = getMainWindow()
  if (!window) {
    focusWindowWhenCreated = true
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f3f6f3',
    title: 'Linux Nexus',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  setMainWindow(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    setMainWindow(null)
    previewAssets.clear()
    void rm(join(app.getPath('temp'), 'linux-nexus-preview'), { recursive: true, force: true })
  })

  if (focusWindowWhenCreated) {
    focusWindowWhenCreated = false
    window.once('ready-to-show', () => {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
  }
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  const userDataDirectory = app.getPath('userData')
  await mkdir(userDataDirectory, { recursive: true })
  configureStateFiles(join(userDataDirectory, 'servers.json'), join(userDataDirectory, 'settings.json'))
  try {
    readState(true)
    readPreviewLimits()
  } catch (error) {
    dialog.showErrorBox(
      '配置文件无效',
      messageFromError(error) + '\n\n应用未修改配置文件。请修复该文件后重新启动。',
    )
    app.exit(1)
    return
  }
  const previewDirectory = join(app.getPath('temp'), 'linux-nexus-preview')
  await rm(previewDirectory, { recursive: true, force: true })
  await mkdir(previewDirectory, { recursive: true })
  registerPreviewProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  dialog.showErrorBox('启动失败', messageFromError(error))
  app.exit(1)
})

app.on('before-quit', () => {
  stopAllSessions()
  previewAssets.clear()
})

app.on('will-quit', () => {
  if (hasSingleInstanceLock) {
    rmSync(join(app.getPath('temp'), 'linux-nexus-preview'), { recursive: true, force: true })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
