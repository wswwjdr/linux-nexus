import { app, net, shell } from 'electron'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ipcMain } from './ipc/trusted-ipc'
import { getMainWindow } from './runtime'
import { parseReleaseVersion } from './update-downloads'
import { AppUpdates } from './update-service'

/**
 * Registers trusted update IPC handlers and returns the controller for the app lifecycle.
 * @param quitForInstall The normal shutdown flow, with an installer callback before exit.
 */
export async function configureAppUpdates(quitForInstall: (openInstaller: () => Promise<void>) => Promise<boolean>): Promise<AppUpdates> {
  const packagedWindows = app.isPackaged && process.platform === 'win32'
  let releaseVersion: string | undefined
  if (packagedWindows) {
    try {
      const metadata: { linuxNexusReleaseVersion?: unknown } = JSON.parse(await readFile(join(app.getAppPath(), 'package.json'), 'utf8'))
      const taggedVersion = metadata.linuxNexusReleaseVersion
      if (typeof taggedVersion !== 'string' || !taggedVersion.startsWith('release-')) throw new Error('Packaged release version is missing')
      const version = taggedVersion.slice('release-'.length)
      parseReleaseVersion(version)
      releaseVersion = version
    } catch (error) {
      logUpdateError(error)
    }
  }
  const updater = new AppUpdates({
    enabled: releaseVersion !== undefined,
    currentVersion: releaseVersion ?? app.getVersion(),
    directory: join(app.getPath('temp'), 'linux-nexus-updates'),
    fetchFile: (url, options) => net.fetch(url, options),
    onState: state => {
      const window = getMainWindow()
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('updates:state', state)
    },
    onError: logUpdateError,
    install: path => quitForInstall(async () => {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    }),
  })
  ipcMain.handle('updates:get-state', () => updater.snapshot())
  ipcMain.handle('updates:check', () => updater.check())
  ipcMain.handle('updates:install', (_event, version: unknown) => updater.install(version))
  ipcMain.handle('updates:cancel', () => updater.cancelDownload())
  return updater
}

/** Records an update failure in the application log while the UI displays localized status. */
function logUpdateError(error: unknown): void {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  const line = `[${new Date().toISOString()}] ${detail}\n`
  void appendFile(join(app.getPath('logs'), 'updates.log'), line).catch(logError => console.error(line, logError))
}
