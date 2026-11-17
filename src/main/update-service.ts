import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { UpdatePhase, UpdateRelease, UpdateState } from '../shared/types/app-update'
import { downloadReleaseFile, isNewerRelease, validateWindowsInstaller } from './update-downloads'
import type { FetchReleaseFile } from './update-downloads'

interface UpdateOptions {
  enabled: boolean
  currentVersion: string
  directory: string
  fetchFile: FetchReleaseFile
  onState: (state: UpdateState) => void
  onError: (error: unknown) => void
  install: (path: string) => Promise<boolean>
}

type Operation = { controller: AbortController; settled: Promise<void> }

export class AppUpdates {
  private state: UpdateState
  private checking?: Operation
  private downloading?: Operation
  private paused = false

  /** Initializes update state from the packaged version and the supplied I/O functions. */
  constructor(private readonly options: UpdateOptions) {
    this.state = { phase: 'idle', revision: 0, currentVersion: options.currentVersion, enabled: options.enabled }
  }

  /** Returns the latest state, including a revision for ordering IPC snapshots and events. */
  snapshot(): UpdateState {
    return this.state
  }

  /** Checks the release directory, sharing the current check across callers. */
  async check(): Promise<UpdateState> {
    if (!this.state.enabled || this.paused || this.downloading) return this.state
    if (!this.checking) {
      const controller = new AbortController()
      const settled = this.checkRelease(controller.signal).then(details => {
        this.checking = undefined
        this.publish(details)
      })
      this.checking = { controller, settled }
    }
    await this.checking.settled
    return this.state
  }

  /** Downloads and opens only the installer matching the version currently offered to the user. */
  async install(version: unknown): Promise<void> {
    const state = this.state
    if (this.paused || this.checking || this.downloading
      || (state.phase !== 'available' && state.phase !== 'download-failed' && state.phase !== 'install-failed')
      || state.release.version !== version) return
    const controller = new AbortController()
    const settled = this.downloadInstaller(state.release, controller.signal).then(details => {
      this.downloading = undefined
      if (details) this.publish(details)
    })
    this.downloading = { controller, settled }
    await settled
  }

  /** Cancels the executable transfer while leaving the offered release available. */
  cancelDownload(): void {
    if (this.state.phase === 'downloading') this.downloading?.controller.abort()
  }

  /** Cancels update network work when normal shutdown is about to clean up application resources. */
  async pause(): Promise<void> {
    this.paused = true
    this.checking?.controller.abort()
    this.cancelDownload()
    await Promise.all([this.checking?.settled, this.state.phase === 'downloading' ? this.downloading?.settled : undefined])
  }

  /** Allows update commands again when the application remains open after attempted shutdown. */
  resume(): void {
    this.paused = false
  }

  /** Removes stale update directories, including installers handed off during earlier runs. */
  async cleanStaleFiles(): Promise<void> {
    if (!this.state.enabled) return
    try {
      await mkdir(this.options.directory, { recursive: true })
      for (const entry of await readdir(this.options.directory, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^(check|install)-[a-zA-Z0-9]{6}$/.test(entry.name)) continue
        const path = join(this.options.directory, entry.name)
        if ((await stat(path)).mtimeMs < Date.now() - 86_400_000) await this.removeTemporaryFiles(path)
      }
    } catch (error) {
      this.options.onError(error)
    }
  }

  /** Checks the version first and reads the release notes only if that version is newer. */
  private async checkRelease(signal: AbortSignal): Promise<UpdatePhase> {
    this.publish({ phase: 'checking' })
    let directory: string | undefined
    try {
      directory = await this.createTemporaryDirectory('check')
      const versionPath = join(directory, 'release_version')
      const found = await downloadReleaseFile(this.options.fetchFile, 'release_version', versionPath,
        { signal, missingAllowed: true, maxBytes: 256 })
      const version = found ? (await readFile(versionPath, 'utf8')).trim() : null
      if (version === null || !isNewerRelease(version, this.options.currentVersion)) {
        return { phase: 'current' }
      }
      const notesPath = join(directory, 'release_notes.md')
      await downloadReleaseFile(this.options.fetchFile, 'release_notes.md', notesPath, { signal, maxBytes: 512 * 1024 })
      const notes = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(notesPath)).trim()
      if (!notes) throw new Error('Release notes are empty')
      return { phase: 'available', release: { version, notes } }
    } catch (error) {
      if (signal.aborted) return { phase: 'idle' }
      this.options.onError(error)
      return { phase: 'check-failed' }
    } finally {
      if (directory) await this.removeTemporaryFiles(directory)
    }
  }

  /** Stages the installer, validates the completed file, and delegates the shutdown and handoff. */
  private async downloadInstaller(release: UpdateRelease, signal: AbortSignal): Promise<UpdatePhase | null> {
    this.publish({ phase: 'downloading', release, received: 0, total: null })
    let directory: string | undefined
    let handedOff = false
    let downloaded = false
    try {
      directory = await this.createTemporaryDirectory('install')
      const name = `Linux-Nexus-Setup-${release.version}.exe`
      const installer = join(directory, name)
      const partial = installer + '.part'
      let lastProgress = 0
      await downloadReleaseFile(this.options.fetchFile, name, partial, {
        signal,
        /** Reports current byte progress at most ten times per second. */
        onProgress: (received, total) => {
          const now = Date.now()
          if (now - lastProgress < 100 && received !== total) return
          lastProgress = now
          this.publish({ phase: 'downloading', release, received, total })
        },
      })
      await validateWindowsInstaller(partial)
      await rename(partial, installer)
      signal.throwIfAborted()
      downloaded = true
      this.publish({ phase: 'installing', release })
      handedOff = await this.options.install(installer)
      return handedOff ? null : { phase: 'available', release }
    } catch (error) {
      if (signal.aborted) return { phase: 'available', release }
      this.options.onError(error)
      return { phase: downloaded ? 'install-failed' : 'download-failed', release }
    } finally {
      if (directory && !handedOff) await this.removeTemporaryFiles(directory)
    }
  }

  /** Creates an isolated work directory so unrelated checks and downloads cannot share files. */
  private async createTemporaryDirectory(prefix: 'check' | 'install'): Promise<string> {
    await mkdir(this.options.directory, { recursive: true })
    return mkdtemp(join(this.options.directory, prefix + '-'))
  }

  /** Removes one update work directory and reports a cleanup failure without hiding the original outcome. */
  private async removeTemporaryFiles(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 })
    } catch (error) {
      this.options.onError(error)
    }
  }

  /** Updates and publishes the state while retaining immutable release metadata. */
  private publish(details: UpdatePhase): void {
    this.state = {
      enabled: this.state.enabled, currentVersion: this.state.currentVersion, revision: this.state.revision + 1, ...details,
    }
    this.options.onState(this.state)
  }
}
