import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, sep } from 'node:path'
import { LocalizedError, messageFromUnknown, msg, tr } from '../shared/i18n/messages'
import type { FileIdentity, LocalEditOutcome, LocalEditTask, LocalEditUpdate, TextFileVersion } from '@shared/types'
import { activeFileIdentity } from './file-identity'
import { downloadLocalEdit, exportLocalEdit as exportCopy, readLocalEdit, streamConfirmedLocalEdit, type LocalEditRevision } from './local-edit-bytes'
import { askLocalEditUpload } from './local-edit-upload-dialog'
import { normalizedRemotePath } from './remote-fs'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { assertWindowsPath } from './transfers/shared'
import { versionedTargetChanged, versionedWriteCapabilities, writeVersionedFile } from './versioned-write'
import { operationCapabilityReport } from './server-capabilities'
import { showWindowsOpenWith } from './windows-open-with'

interface Draft extends LocalEditRevision {
  handled: boolean
}

interface Edit extends Omit<LocalEditTask, 'busy'> {
  directory: string
  file: string
  target: string
  identity: FileIdentity
  version: TextFileVersion
  draft?: Draft
  phase?: 'review' | 'upload' | 'action'
  manualUpload: boolean
  watcher?: FSWatcher
  timer?: NodeJS.Timeout
  checking?: Promise<void>
}

const edits = new Map<string, Edit>()
const opening = new Set<string>()
const uploadQueue = new Set<Edit>()
let uploadWork: Promise<void> | undefined
let uploadPrompt: AbortController | undefined
let closing = false

/** Returns the local editing tasks without exposing temporary paths or connection credentials. */
export function listLocalEdits(): LocalEditTask[] {
  return [...edits.values()].map(({ id, name, remotePath, server, state, phase, manualUpload, autoUpload, conflict, error }) =>
    ({ id, name, remotePath, server, state, busy: Boolean(phase || manualUpload), autoUpload, conflict, error }))
}

/** Publishes the current tasks and any completed upload outcome. */
function publish(outcome?: LocalEditOutcome): void {
  const window = getMainWindow()
  const update: LocalEditUpdate = { tasks: listLocalEdits(), outcome }
  if (window && !window.webContents.isDestroyed()) window.webContents.send('files:local-edits', update)
}

/** Returns the application-owned directory containing the local editing copies. */
function editRoot(): string {
  return join(app.getPath('temp'), 'linux-nexus-local-edits')
}

/** Identifies a verified SSH endpoint and account independently of a connection tab. */
function targetFor(session: ActiveSession): string | undefined {
  if (session.kind === 'files' && session.platform && session.hostFingerprint && session.username) {
    return JSON.stringify([session.platform.endpoint, session.username, session.hostFingerprint])
  }
}

/** Schedules a content check after writes settle, including writes that replace the file. */
function scheduleCheck(edit: Edit, delay = 600): void {
  clearTimeout(edit.timer)
  edit.timer = setTimeout(() => {
    edit.timer = undefined
    if (edit.phase || closing || edits.get(edit.id) !== edit) return
    if (edit.checking) { scheduleCheck(edit); return }
    edit.checking = refreshDraft(edit).then(() => {
      if (!edit.timer && needsUpload(edit)) uploadQueue.add(edit)
    }).finally(() => {
      edit.checking = undefined
      processUploadQueue()
    })
  }, delay)
  edit.timer.unref()
}

/** Reads the current revision while preserving decisions for unchanged bytes. */
async function refreshDraft(edit: Edit): Promise<Draft | undefined> {
  const previousState = edit.state
  const previousDraft = edit.draft
  const previousRequest = edit.manualUpload
  try {
    const current = await readLocalEdit(edit.file)
    edit.draft = current.hash === edit.version.hash ? undefined
      : current.hash === previousDraft?.hash ? previousDraft : { ...current, handled: false }
    edit.state = edit.draft ? 'modified' : 'ready'
    if (!edit.draft) edit.manualUpload = false
    if (edit.draft !== previousDraft && !edit.conflict) edit.error = undefined
  } catch (error) {
    if (previousState !== 'unavailable') console.error('Could not check local edit', edit.id, error)
    edit.state = 'unavailable'
    edit.manualUpload = false
  }
  if (edit.state !== previousState || edit.draft !== previousDraft || edit.manualUpload !== previousRequest) publish()
  return edit.state === 'modified' ? edit.draft : undefined
}

/** Checks whether a task has a new revision or an explicit request to retry it. */
function needsUpload(edit: Edit): boolean {
  return !edit.conflict && edit.state === 'modified' && Boolean(edit.draft && (!edit.draft.handled || edit.manualUpload))
}

/** Reports whether another local edit dialog may be active. */
function localActionActive(): boolean {
  return opening.size > 0 || [...edits.values()].some(edit => edit.phase === 'action')
}

/** Processes one task at a time so native prompts and commits stay in order. */
function processUploadQueue(): void {
  if (closing || uploadWork || localActionActive() || !getMainWindow()) return
  const edit = uploadQueue.values().next().value
  if (!edit) return
  uploadQueue.delete(edit)
  uploadWork = reviewAndUpload(edit).finally(() => {
    uploadWork = undefined
    processUploadQueue()
  })
}

/** Checks working copies when the application regains focus. */
export function recheckLocalEdits(): void {
  for (const edit of edits.values()) scheduleCheck(edit)
}

/** Downloads a remote file once per identity and opens the Windows app picker.
 * @param sessionId Originating file session supplied by trusted IPC.
 * @param value Remote path supplied by trusted IPC.
 */
export async function openLocalEdit(sessionId: unknown, value: unknown): Promise<void> {
  assertOpen()
  if (process.platform !== 'win32') throw new LocalizedError(msg('localEdit.openUnavailable'))
  if (typeof sessionId !== 'string' || typeof value !== 'string' || !posix.isAbsolute(value)) {
    throw new LocalizedError(msg('errors.invalidRemotePath'))
  }
  const session = sessions.get(sessionId)
  const target = session && targetFor(session)
  if (!session || !target || !session.platform) throw new LocalizedError(msg('errors.fileSessionIsNotConnected'))
  const { identity, commands } = activeFileIdentity(session)
  const remotePath = normalizedRemotePath(value)
  const name = posix.basename(remotePath)
  if (!name) throw new LocalizedError(msg('localEdit.targetChanged'))
  assertWindowsPath(name)
  const window = getMainWindow()
  if (!window) throw new LocalizedError(msg('localEdit.openUnavailable'))
  if (uploadPrompt || localActionActive()) throw new LocalizedError(msg('localEdit.busy'))
  const current = [...edits.values()].find(edit => edit.target === target && edit.identity === identity && edit.remotePath === remotePath)
  if (current) {
    await withEdit(current.id, async edit => {
      await readLocalEdit(edit.file)
      await showWindowsOpenWith(window, edit.file)
    })
    return
  }
  const key = JSON.stringify([target, identity, remotePath])
  if (opening.has(key)) throw new LocalizedError(msg('localEdit.busy'))
  opening.add(key)
  let directory: string | undefined
  try {
    await mkdir(editRoot(), { recursive: true })
    directory = await mkdtemp(join(editRoot(), 'edit-'))
    const file = join(directory, name)
    const version = await commands.track(downloadLocalEdit(commands, remotePath, file))
    if (await showWindowsOpenWith(window, file) === 'cancelled') return
    const edit: Edit = {
      id: randomUUID(), name, directory, file, target, identity, remotePath, version,
      server: `${session.username}@${session.platform.endpoint}`, state: 'ready', autoUpload: false, manualUpload: false,
    }
    edits.set(edit.id, edit)
    directory = undefined
    try {
      edit.watcher = watch(edit.directory, (_event, filename) => {
        if (!filename || filename.toLowerCase() === name.toLowerCase()) {
          uploadQueue.delete(edit)
          scheduleCheck(edit)
        }
      })
      edit.watcher.on('error', error => {
        console.error('Local edit watcher failed', edit.id, error)
        edit.watcher?.close()
        scheduleCheck(edit)
      })
    } catch (error) {
      console.error('Could not watch local edit', edit.id, error)
    }
    scheduleCheck(edit)
    publish()
  } finally {
    try {
      if (directory) await rm(directory, { recursive: true, force: true })
    } finally {
      opening.delete(key)
      processUploadQueue()
    }
  }
}

/** Serializes actions for a task and schedules a fresh content check afterward. */
async function withEdit<T>(id: unknown, action: (edit: Edit) => Promise<T>): Promise<T> {
  assertOpen()
  const edit = availableEdit(id)
  if (uploadPrompt || localActionActive()) throw new LocalizedError(msg('localEdit.busy'))
  edit.phase = 'action'
  publish()
  try {
    await edit.checking
    return await action(edit)
  } finally {
    if (edits.has(edit.id)) {
      edit.phase = undefined
      scheduleCheck(edit)
    }
    publish()
    processUploadQueue()
  }
}

/** Resolves an IPC task ID and verifies it can accept a new user action. */
function availableEdit(id: unknown): Edit {
  const edit = typeof id === 'string' ? edits.get(id) : undefined
  if (!edit) throw new LocalizedError(msg('localEdit.taskMissing'))
  if (edit.phase || edit.manualUpload) throw new LocalizedError(msg('localEdit.busy'))
  return edit
}

/** Prevents new editing operations while a quit or restart is in progress. */
function assertOpen(): void {
  if (closing) throw new LocalizedError(msg('localEdit.busy'))
}

/** Queues an explicit upload attempt, including revisions previously skipped or failed. */
export function uploadLocalEdit(id: unknown): void {
  assertOpen()
  const edit = availableEdit(id)
  if (edit.conflict) throw new LocalizedError(msg('localEdit.conflict'))
  edit.manualUpload = true
  scheduleCheck(edit, 0)
  publish()
}

/** Restores prompting for future revisions of the selected task. */
export function restoreLocalEditPrompt(id: unknown): void {
  assertOpen()
  availableEdit(id).autoUpload = false
  publish()
}

/** Revalidates the queued revision, obtains approval when needed, and handles its outcome. */
async function reviewAndUpload(edit: Edit): Promise<void> {
  if (edit.phase || !needsUpload(edit) || edits.get(edit.id) !== edit) return
  edit.phase = 'review'
  publish()
  let revision: Draft | undefined
  try {
    await edit.checking
    revision = await refreshDraft(edit)
    if (!revision || !needsUpload(edit) || closing || localActionActive()) return
    if (!edit.autoUpload || edit.manualUpload) {
      const choice = await promptForUpload(edit)
      if (closing || !choice) return
      const current = await refreshDraft(edit)
      if (current !== revision || closing) return
      revision.handled = true
      edit.manualUpload = false
      if (choice === 'skip') return
      edit.autoUpload = choice === 'always'
    }
    revision.handled = true
    edit.phase = 'upload'
    edit.error = undefined
    publish()
    const sessionId = await commitLocalEdit(edit, revision)
    edit.state = 'ready'
    edit.draft = undefined
    publish({ type: 'saved', sessionId, remotePath: edit.remotePath })
  } catch (error) {
    if (revision) revision.handled = true
    edit.manualUpload = false
    edit.error = messageFromUnknown(error)
    publish({ type: 'failed', error: edit.error })
  } finally {
    edit.phase = undefined
    scheduleCheck(edit)
    publish()
  }
}

/** Displays the native confirmation and exposes cancellation to the shutdown flow. */
async function promptForUpload(edit: Edit) {
  const window = getMainWindow()
  if (!window || window.isDestroyed()) return
  const controller = new AbortController()
  uploadPrompt = controller
  try {
    return await askLocalEditUpload(window, describe(edit), controller.signal)
  } finally {
    uploadPrompt = undefined
  }
}

/** Writes the approved bytes through the original SSH endpoint and effective identity. */
async function commitLocalEdit(edit: Edit, revision: LocalEditRevision): Promise<string> {
  const connection = [...sessions.values()]
    .filter(session => targetFor(session) === edit.target)
    .map(session => ({ ...activeFileIdentity(session), sessionId: session.sessionId }))
    .find(candidate => candidate.identity === edit.identity)
  if (!connection) throw new LocalizedError(msg('localEdit.connectionRequired'))
  const { commands, sessionId } = connection
  try {
    const result = await commands.track(writeVersionedFile(commands, edit.remotePath,
      edit.version, revision.size, revision.hash, streamConfirmedLocalEdit(edit.file, revision), { timeoutMs: 86_400_000 }))
    if (result.status === 'saved') {
      edit.version = result.version
      return sessionId
    }
    edit.conflict = true
  } catch (error) {
    if (!versionedTargetChanged(error)) {
      const report = operationCapabilityReport(error, versionedWriteCapabilities)
      if (report) throw new LocalizedError(msg('localEdit.dependencies', { tools: [...report.missing, ...report.incompatible].join(', ') }))
      throw error
    }
    edit.autoUpload = false
    throw new LocalizedError(msg('localEdit.targetChangedDuringUpload'))
  }
  edit.autoUpload = false
  throw new LocalizedError(msg('localEdit.conflict'))
}

/** Shows a native message box belonging to the main window when it exists. */
function messageBox(options: MessageBoxOptions) {
  const window = getMainWindow()
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
}

/** Formats a user-facing edit destination. */
function describe(edit: Edit): string {
  return `${edit.server}  ${edit.remotePath}`
}

/** Asks for an export folder outside the application-managed directory. */
async function chooseExportDirectory(): Promise<string | undefined> {
  const window = getMainWindow()
  const options = { title: tr('localEdit.chooseExportFolder'), properties: ['openDirectory', 'createDirectory'] as const }
  const selection = { ...options, properties: [...options.properties] }
  const result = window ? await dialog.showOpenDialog(window, selection) : await dialog.showOpenDialog(selection)
  if (result.canceled || !result.filePaths[0]) return
  const directory = await realpath(result.filePaths[0])
  const fromRoot = relative(await realpath(editRoot()), directory)
  if (!fromRoot || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith('..' + sep))) {
    throw new LocalizedError(msg('localEdit.exportOutside'))
  }
  return directory
}

/** Exports one task without overwriting files in the selected folder. */
export function exportLocalEdit(id: unknown): Promise<boolean> {
  return withEdit(id, async edit => {
    const directory = await chooseExportDirectory()
    if (!directory) return false
    const { hash } = await readLocalEdit(edit.file)
    await exportCopy(edit.file, directory, edit.name, hash)
    return true
  })
}

/** Drops a task after the user confirms its temporary files can be deleted. */
export function discardLocalEdit(id: unknown): Promise<void> {
  return withEdit(id, async edit => {
    const { response } = await messageBox({
      type: 'warning', message: tr('localEdit.confirmDiscard'), detail: describe(edit),
      buttons: [tr('common.cancel'), tr('localEdit.discard')], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (response === 1) await removeEdit(edit)
  })
}

/** Deletes the copy before removing its in-memory task. */
async function removeEdit(edit: Edit): Promise<void> {
  await rm(edit.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  clearTimeout(edit.timer)
  edit.watcher?.close()
  uploadQueue.delete(edit)
  edits.delete(edit.id)
}

/** Rechecks all copies before a quit or restart, then asks how to handle pending edits. */
export async function prepareLocalEditExit(): Promise<boolean> {
  closing = true
  uploadQueue.clear()
  if ([...edits.values()].some(edit => edit.phase === 'upload')) throw new LocalizedError(msg('localEdit.uploadingAtExit'))
  uploadPrompt?.abort()
  await uploadWork
  if (localActionActive()) throw new LocalizedError(msg('localEdit.busy'))
  const pending = await pendingEdits()
  if (!pending.length) return true
  const { response } = await messageBox({
    type: 'warning', message: tr('localEdit.exitTitle'), detail: pending.map(({ edit }) => describe(edit)).join('\n'),
    buttons: [tr('localEdit.returnToApp'), tr('localEdit.exportAndExit'), tr('localEdit.discardAndExit')],
    defaultId: 0, cancelId: 0, noLink: true,
  })
  if (response === 0) return false
  if (response === 2) {
    const confirmation = await messageBox({
      type: 'warning', message: tr('localEdit.confirmDiscardExit'),
      buttons: [tr('localEdit.returnToApp'), tr('localEdit.discardAndExit')], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (confirmation.response !== 1) return false
    await checkExitRevisions(pending)
    return true
  }
  const directory = await chooseExportDirectory()
  if (!directory) return false
  for (const { edit, hash } of pending) await exportCopy(edit.file, directory, edit.name, hash)
  await checkExitRevisions(pending)
  return true
}

/** Stops shutdown when a pending copy has changed since the user made their decision. */
async function checkExitRevisions(confirmed: Awaited<ReturnType<typeof pendingEdits>>): Promise<void> {
  const revisions = new Map(confirmed.map(({ edit, hash }) => [edit.id, hash]))
  if ((await pendingEdits()).some(({ edit, hash }) => revisions.get(edit.id) !== hash)) {
    throw new LocalizedError(msg('localEdit.exitChanged'))
  }
}

/** Reads the current content of every copy and returns the revisions pending upload. */
async function pendingEdits(): Promise<{ edit: Edit; hash: string }[]> {
  const pending: { edit: Edit; hash: string }[] = []
  for (const edit of edits.values()) {
    try {
      await edit.checking
      const { hash } = await readLocalEdit(edit.file)
      if (hash !== edit.version.hash) pending.push({ edit, hash })
    } catch (error) {
      console.error('Could not check local edit at exit', edit.id, error)
      throw new LocalizedError(msg('localEdit.checkFailed', { name: edit.name }))
    }
  }
  return pending
}

/** Cleans up managed copies after the user has resolved the pending edits. */
export async function cleanUpLocalEdits(): Promise<void> {
  try {
    for (const edit of edits.values()) await removeEdit(edit)
  } finally {
    publish()
  }
}

/** Resumes editing actions when a shutdown attempt returns to the application. */
export function resumeLocalEdits(): void {
  closing = false
  recheckLocalEdits()
}
