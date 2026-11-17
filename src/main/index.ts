import { prepareSettingsExit } from './settings-service'
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
import { readAppSettings } from './settings-store'
import { configureStateFiles, readState } from './state-store'
import { configureAssistantStorage } from './assistant-storage'
import { stopAllAssistantTasks } from './assistant-runtime'
import { applyTheme, themeBackgroundColor } from './theme'
import { configurePerformanceMonitorInterval, stopAllPerformanceMonitors } from './performance-monitor'
import { publishWindowLayoutChanges } from './window-layout'
import { cleanUpLocalEdits, prepareLocalEditExit, recheckLocalEdits, resumeLocalEdits } from './local-edits'
import { configureAppUpdates } from './app-updates'
import type { AppUpdates } from './update-service'

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

let focusWindowWhenCreated = false
let updater: AppUpdates | undefined
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

/** Creates the main window and registers its lifecycle handlers. */
function createWindow(): void {
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
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock || !applicationDataConfigured) return
  Menu.setApplicationMenu(null)
  const userDataDirectory = app.getPath('userData')
  configureStateFiles(join(userDataDirectory, 'servers.json'), join(userDataDirectory, 'application-settings.json'))
  configureAssistantStorage(userDataDirectory)
  try {
    applyLanguage('system')
    const settings = readAppSettings()
    applyLanguage(settings.general.language)
    readState(true)
    configurePerformanceMonitorInterval(settings.monitoring.sampleIntervalSeconds)
    applyTheme(settings.general.theme)
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
  updater = await configureAppUpdates(quitApplication)
  createWindow()
  void updater.cleanStaleFiles()
  void updater.check()
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

/** Stops application work and removes temporary files before exit. */
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
 * Resolves external edits and shuts down the app.
 * @param openInstaller Optional handoff to run after cleanup and before exiting.
 * @returns Whether the application approved shutdown and requested exit.
 */
async function quitApplication(openInstaller?: () => Promise<void>): Promise<boolean> {
  if (quitting) return false
  quitting = true
  try {
    if (!await prepareSettingsExit()) return false
    if (!await prepareLocalEditExit()) return false
    await updater?.pause()
    await cleanUpBeforeExit()
    if (openInstaller) await openInstaller()
    allowQuit = true
    app.quit()
    return true
  } catch (error) {
    if (openInstaller) throw error
    showErrorBox(msg('errors.cleanupFailedOnExit'), messageFromError(error))
    return false
  } finally {
    if (!allowQuit) {
      quitting = false
      resumeLocalEdits()
      updater?.resume()
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
