import { type MessageValue, msg, renderMessage } from '../shared/i18n/messages'
import { applyLanguage } from './language'

import { app, BrowserWindow, dialog, Menu, protocol } from 'electron'
import { mkdir, rm } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { stopAllSessions } from './connections'
import { registerIpc } from './ipc'
import { registerPreviewProtocol } from './preview-protocol'
import { clearPreviewAssets, getMainWindow, messageFromError, setMainWindow } from './runtime'
import { configureStateFiles, readAppSettings, readState } from './state-store'
import { configureAssistantStorage } from './assistant-storage'
import { stopAllAssistantTasks } from './assistant-runtime'
import { applyTheme, themeBackgroundColor } from './theme'
import { configurePerformanceMonitorInterval, stopAllPerformanceMonitors } from './performance-monitor'
import { publishWindowLayoutChanges } from './window-layout'
import { registerUpdates } from './updates'
import { cleanUpLocalEdits, prepareLocalEditExit, recheckLocalEdits, resumeLocalEdits } from './local-edits'

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let focusWindowWhenCreated = false
const applicationDataDirectory = app.isPackaged
  ? app.getPath('userData')
  : join(app.getAppPath(), 'data')
app.setPath('userData', applicationDataDirectory)
const hasSingleInstanceLock = app.requestSingleInstanceLock()
let applicationDataConfigured = false
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  try {
    configureApplicationData(applicationDataDirectory)
    applicationDataConfigured = true
  } catch (error) {
    showErrorBox(msg('errors.startupFailed'), messageFromError(error))
    app.quit()
  }
  app.on('second-instance', focusMainWindow)
}

function configureApplicationData(dataDirectory: string): void {
  mkdirSync(dataDirectory, { recursive: true })
  const sessionDirectory = join(dataDirectory, 'session')
  const temporaryDirectory = join(dataDirectory, 'temp')
  const logsDirectory = join(dataDirectory, 'logs')
  const crashDumpsDirectory = join(dataDirectory, 'crash-dumps')
  for (const directory of [dataDirectory, temporaryDirectory, logsDirectory, crashDumpsDirectory]) {
    mkdirSync(directory, { recursive: true })
  }

  mkdirSync(sessionDirectory, { recursive: true })
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

/** @returns The trusted main window, which signals when the startup check can begin. */
function createWindow(): BrowserWindow {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'app.ico')
    : join(app.getAppPath(), 'resources', 'app.ico')
  const window = new BrowserWindow({
    show: false,
    width: 1160,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: themeBackgroundColor(),
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
  publishWindowLayoutChanges(window)
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(details.isMainFrame && details.requestingUrl === window.webContents.getURL() && contents === window.webContents && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission))
  })
  window.webContents.session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    details.isMainFrame && details.requestingUrl === window.webContents.getURL() && contents === window.webContents && ['clipboard-read', 'clipboard-sanitized-write'].includes(permission))

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('focus', recheckLocalEdits)
  window.on('close', event => {
    if (allowQuit || process.platform === 'darwin') return
    event.preventDefault()
    app.quit()
  })
  window.on('closed', () => {
    setMainWindow(null)
    clearPreviewAssets()
  })

  window.once('ready-to-show', () => {
    window.show()
    if (focusWindowWhenCreated) {
      focusWindowWhenCreated = false
      window.focus()
    }
  })
  return window
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock || !applicationDataConfigured) return
  Menu.setApplicationMenu(null)
  const userDataDirectory = app.getPath('userData')
  configureStateFiles(join(userDataDirectory, 'servers.json'), join(userDataDirectory, 'settings.json'))
  configureAssistantStorage(userDataDirectory)
  try {
    applyLanguage('system')
    const settings = readAppSettings()
    applyLanguage(settings.language)
    readState(true)
    configurePerformanceMonitorInterval(settings.performanceSampleIntervalSeconds)
    applyTheme(settings.theme)
  } catch (error) {
    showErrorBox(
      msg('errors.invalidConfigurationFile'),
      msg('errors.theApplicationHasNotModifiedTheConfigurationFileFixIt', { "value1": messageFromError(error) }),
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
  const checkAtStartup = registerUpdates(restartForUpdate)
  const window = createWindow()
  window.once('ready-to-show', () => {
    void checkAtStartup(window).catch(error => console.error('Startup update prompt failed', error))
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  showErrorBox(msg('errors.startupFailed'), messageFromError(error))
  app.exit(1)
})

let quitting = false
let allowQuit = false
const temporaryDirectories = ['linux-nexus-preview', 'linux-nexus-downloads']

/** Stops application work and removes temporary files before exit or update installation. */
async function cleanUpBeforeExit(): Promise<void> {
  await cleanUpLocalEdits()
  stopAllPerformanceMonitors()
  await stopAllAssistantTasks()
  await stopAllSessions()
  clearPreviewAssets()
  for (const name of temporaryDirectories) {
    await rm(join(app.getPath('temp'), name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

/**
 * Finishes shutdown work before NSIS can close the app and replace files.
 * @param launch Launches the verified installer.
 * @returns Whether the requested shutdown was approved and the installer launched.
 */
async function restartForUpdate(launch: () => void): Promise<boolean> {
  if (quitting) throw new Error('Application is already closing')
  quitting = true
  try {
    if (!await prepareLocalEditExit()) return false
    await cleanUpBeforeExit()
    allowQuit = true
    launch()
    return true
  } catch (error) {
    allowQuit = false
    try {
      await Promise.all(temporaryDirectories.map(name => mkdir(join(app.getPath('temp'), name), { recursive: true })))
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], 'Could not restore temporary directories after the update failed')
    }
    throw error
  } finally {
    if (!allowQuit) {
      quitting = false
      resumeLocalEdits()
    }
  }
}

/** Resolves external edits before the normal application shutdown. */
async function quitApplication(): Promise<void> {
  quitting = true
  try {
    if (!await prepareLocalEditExit()) return
    await cleanUpBeforeExit()
    allowQuit = true
    app.quit()
  } catch (error) {
    showErrorBox(msg('errors.cleanupFailedOnExit'), messageFromError(error))
  } finally {
    if (!allowQuit) {
      quitting = false
      resumeLocalEdits()
    }
  }
}

app.on('before-quit', event => {
  if (!hasSingleInstanceLock || allowQuit) return
  event.preventDefault()
  if (!quitting) void quitApplication()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

function showErrorBox(title: MessageValue, message: MessageValue): void {
  dialog.showErrorBox(renderMessage(title), renderMessage(message))
}
