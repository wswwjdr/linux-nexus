import { app, dialog, net, type BrowserWindow } from 'electron'
import { NsisUpdater } from 'electron-updater'
import { createPublicKey } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { messageFromUnknown, renderMessage, tr } from '../shared/i18n/messages'
import type { UpdateState } from '../shared/types/updates'
import { ipcMain } from './ipc/trusted-ipc'
import { getMainWindow } from './runtime'
import { releaseSignaturePayload, verifyInstaller, verifyReleaseSignature } from './update-signature.mts'

declare const __UPDATE_PUBLIC_KEY__: string
declare const __RELEASE_DISPLAY_VERSION__: string

const releaseDownloads = 'https://github.com/wswwjdr/linux-nexus/releases/download'

/**
 * Configures the packaged Windows updater and registers trusted commands.
 * @param restart Runs the application's normal cleanup and invokes the installer launch callback.
 * @returns A function that performs the background startup check.
 */
export function registerUpdates(restart: (launch: () => void) => Promise<void>): (window: BrowserWindow) => Promise<void> {
  const enabled = app.isPackaged && process.platform === 'win32' && Boolean(__UPDATE_PUBLIC_KEY__ && __RELEASE_DISPLAY_VERSION__)
  const publicKey = enabled ? createPublicKey(__UPDATE_PUBLIC_KEY__) : null
  const updater = enabled ? new NsisUpdater() : null
  const currentVersion = __RELEASE_DISPLAY_VERSION__ || app.getVersion()
  let state: UpdateState = { currentVersion, status: enabled ? 'idle' : 'disabled' }
  let active: Promise<void> | undefined
  let verified: ReturnType<typeof releaseSignaturePayload> | undefined
  let installerPath: string | undefined
  let installError: Error | undefined

  if (updater) {
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.allowPrerelease = false
    updater.disableWebInstaller = true
    updater.on('error', error => {
      console.error('Updater error', error)
      if (state.status === 'installing') installError = error
    })
    updater.on('download-progress', ({ percent }) => {
      if (state.status !== 'downloading' || !Number.isFinite(percent)) return
      const progress = Math.min(100, Math.max(0, Math.round(percent)))
      if (progress === state.progress) return
      updateState('downloading', { nextVersion: state.nextVersion, progress })
      getMainWindow()?.setProgressBar(progress / 100)
    })
  }

  /**
   * Publishes the latest update state to the trusted window.
   * @param status Next stage of the update.
   * @param details Data for that stage.
   */
  function updateState(status: UpdateState['status'], details: Partial<Omit<UpdateState, 'status' | 'currentVersion'>> = {}): void {
    state = { currentVersion, status, ...details }
    const window = getMainWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('updates:state', state)
  }

  /**
   * Serializes updater calls so that a second check cannot replace metadata during a download.
   * @param operation An updater action.
   * @returns Completion of the action already running or newly started.
   */
  function run(operation: () => Promise<void>): Promise<void> {
    active ??= Promise.resolve().then(operation).finally(() => { active = undefined })
    return active
  }

  /** Checks GitHub and makes a newer release available only after verifying its signed metadata. */
  async function check(): Promise<void> {
    if (!updater || !publicKey || state.status === 'ready' || state.status === 'installing') return
    verified = undefined
    installerPath = undefined
    updateState('checking')
    try {
      const result = await updater.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        updateState('current')
        return
      }
      const metadata = result.updateInfo as typeof result.updateInfo & { tag?: unknown }
      if (typeof metadata.tag !== 'string') throw new Error('Update is missing its GitHub release tag')
      const release = releaseSignaturePayload(metadata.tag, metadata)
      const signature = await fetchSignature(release.tag)
      verified = verifyReleaseSignature(release.tag, metadata, signature, publicKey)
      updateState('available', { nextVersion: verified.displayVersion })
    } catch (error) {
      console.error('Update check failed', error)
      updateState('check-failed', { error: messageFromUnknown(error) })
    }
  }

  /** Downloads the previously verified release after the user clicks Download. */
  async function download(): Promise<void> {
    if (!updater || !verified || state.status !== 'available') return
    const nextVersion = verified.displayVersion
    try {
      updateState('downloading', { nextVersion, progress: 0 })
      getMainWindow()?.setProgressBar(0)
      const [path] = await updater.downloadUpdate()
      if (!path) throw new Error('Update download did not return the installer')
      await verifyCachedInstaller(path, verified.sha512)
      installerPath = path
      updateState('ready', { nextVersion })
    } catch (error) {
      console.error('Update download failed', error)
      updateState('available', { nextVersion, error: messageFromUnknown(error) })
    } finally {
      getMainWindow()?.setProgressBar(-1)
    }
  }

  /** Confirms the interruption, verifies the pending installer again and hands off to NSIS. */
  async function install(): Promise<void> {
    const window = getMainWindow()
    if (!updater || !verified || !installerPath || state.status !== 'ready' || !window || window.isDestroyed()) return
    const nextVersion = verified.displayVersion
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      message: tr('updates.restartAndInstall'),
      detail: tr('updates.restartWarning'),
      buttons: [tr('updates.later'), tr('updates.restartAndInstall')],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1 || window.isDestroyed()) return
    updateState('installing', { nextVersion })
    try {
      await verifyCachedInstaller(installerPath, verified.sha512)
    } catch (error) {
      installerPath = undefined
      updateState('available', { nextVersion, error: messageFromUnknown(error) })
      return
    }
    try {
      window.setEnabled(false)
      await restart(() => {
        installError = undefined
        updater.quitAndInstall(true, true)
        if (installError) throw installError
      })
    } catch (error) {
      console.error('Update installation failed', error)
      if (!window.isDestroyed()) window.setEnabled(true)
      updateState('ready', { nextVersion, error: messageFromUnknown(error) })
    }
  }

  /** @returns Current state for a renderer that has just subscribed. */
  function snapshot(): UpdateState {
    return state
  }

  ipcMain.handle('updates:snapshot', snapshot)
  ipcMain.handle('updates:check', () => run(check))
  ipcMain.handle('updates:download', () => run(download))
  ipcMain.handle('updates:install', () => run(install))

  /**
   * Checks once at startup and asks before downloading.
   * @param window Main window that owns the update prompt.
   */
  return async function checkAtStartup(window: BrowserWindow): Promise<void> {
    if (!updater) return
    await run(check)
    if (state.status !== 'available' || !state.nextVersion || window.isDestroyed()) return
    const { response } = await dialog.showMessageBox(window, {
      type: 'info',
      message: tr('updates.available', { version: state.nextVersion }),
      buttons: [tr('updates.later'), tr('updates.download')],
      defaultId: 0,
      cancelId: 0,
    })
    if (response !== 1 || window.isDestroyed()) return
    await run(download)
    if (window.isDestroyed()) return
    const downloaded = snapshot()
    if (downloaded.status === 'ready') await run(install)
    const outcome = snapshot()
    if (!outcome.error || window.isDestroyed()) return
    await dialog.showMessageBox(window, {
      type: 'error',
      message: tr(downloaded.status === 'ready' ? 'updates.installFailed' : 'updates.downloadFailed'),
      detail: renderMessage(outcome.error),
    })
  }
}

/**
 * Fetches the exact release's detached signature and bounds the response to an Ed25519 signature.
 * @param tag Validated release tag.
 * @returns Signature bytes.
 */
async function fetchSignature(tag: string): Promise<Buffer> {
  const response = await net.fetch(`${releaseDownloads}/${tag}/latest.yml.sig`, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok || !response.body) throw new Error(`Update signature is unavailable (HTTP ${response.status})`)
  const reader = response.body.getReader()
  const signature = Buffer.alloc(64)
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return signature.subarray(0, length)
      if (length + value.length > signature.length) throw new Error('Invalid update signature size')
      signature.set(value, length)
      length += value.length
    }
  } finally {
    await reader.cancel()
  }
}

/**
 * Removes an unreadable or invalid cached installer so a retry can fetch a fresh copy.
 * @param path Installer path returned by the updater.
 * @param expectedHash Signed installer digest.
 */
async function verifyCachedInstaller(path: string, expectedHash: string): Promise<void> {
  try {
    await verifyInstaller(path, expectedHash)
  } catch (error) {
    try {
      await rm(path, { force: true })
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `Invalid update could not be removed: ${renderMessage(messageFromUnknown(cleanupError))}`)
    }
    throw error
  }
}

