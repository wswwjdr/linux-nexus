import { app, BrowserWindow, dialog, Menu, protocol } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { stopAllSessions } from './connections'
import { registerIpc } from './ipc'
import { registerPreviewProtocol } from './preview-protocol'
import { clearPreviewAssets, getMainWindow, messageFromError, setMainWindow } from './runtime'
import { configureStateFiles, readPreviewLimits, readState } from './state-store'

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let focusWindowWhenCreated = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let applicationDataConfigured = false
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  try {
    configureApplicationData()
    applicationDataConfigured = true
  } catch (error) {
    dialog.showErrorBox('启动失败', messageFromError(error))
    app.quit()
  }
  app.on('second-instance', focusMainWindow)
}

function configureApplicationData(): void {
  const dataDirectory = app.isPackaged
    ? join(app.getPath('appData'), 'Linux Nexus')
    : join(app.getAppPath(), 'data')
  const sessionDirectory = join(dataDirectory, 'session')
  const temporaryDirectory = join(dataDirectory, 'temp')
  const logsDirectory = join(dataDirectory, 'logs')
  const crashDumpsDirectory = join(dataDirectory, 'crash-dumps')
  for (const directory of [dataDirectory, temporaryDirectory, logsDirectory, crashDumpsDirectory]) {
    mkdirSync(directory, { recursive: true })
  }

  mkdirSync(sessionDirectory, { recursive: true })
  app.setPath('userData', dataDirectory)
  app.setPath('sessionData', sessionDirectory)
  app.setPath('temp', temporaryDirectory)
  app.setPath('crashDumps', crashDumpsDirectory)
  app.setAppLogsPath(logsDirectory)
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
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(app.getAppPath(), 'resources', 'app.ico')
  const window = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f3f6f3',
    title: 'Linux Nexus',
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.setMenu(null)
  setMainWindow(window)

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    setMainWindow(null)
    clearPreviewAssets()
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
  if (!hasSingleInstanceLock || !applicationDataConfigured) return
  Menu.setApplicationMenu(null)
  const userDataDirectory = app.getPath('userData')
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
  const downloadDirectory = join(app.getPath('temp'), 'linux-nexus-downloads')
  await rm(previewDirectory, { recursive: true, force: true })
  await rm(downloadDirectory, { recursive: true, force: true })
  await mkdir(previewDirectory, { recursive: true })
  await mkdir(downloadDirectory, { recursive: true })
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
  clearPreviewAssets()
  stopAllSessions()
})

app.on('will-quit', () => {
  if (hasSingleInstanceLock) {
    rmSync(join(app.getPath('temp'), 'linux-nexus-preview'), { recursive: true, force: true })
    rmSync(join(app.getPath('temp'), 'linux-nexus-downloads'), { recursive: true, force: true })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
