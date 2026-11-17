import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import type { UpdateState } from '@shared/types/app-update'

type ManualCheck = 'idle' | 'checking' | 'current' | 'failed'
const UpdateContext = createContext<{
  state: UpdateState | null
  manualCheck: ManualCheck
  check: () => Promise<void>
} | null>(null)

/** Shares software-update state with settings and presents eligible releases once per offer. */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null)
  const [manualCheck, setManualCheck] = useState<ManualCheck>('idle')
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    /** Applies snapshots that are at least as recent as the last received update event. */
    const receive = (incoming: UpdateState) => {
      if (active) setState(current => current && current.revision > incoming.revision ? current : incoming)
    }
    const unsubscribe = window.remoteFiles.onUpdateState(receive)
    void window.remoteFiles.getUpdateState().then(receive).catch(error => console.error('Could not read software update state', error))
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  /** Joins or starts a check and allows a previously dismissed release to be shown again. */
  async function check(): Promise<void> {
    setManualCheck('checking')
    try {
      const result = await window.remoteFiles.checkForUpdates()
      setState(current => current && current.revision > result.revision ? current : result)
      if (result.phase === 'available') setDismissed(null)
      setManualCheck(result.phase === 'current' ? 'current' : result.phase === 'check-failed' ? 'failed' : 'idle')
    } catch (error) {
      console.error('Could not check for software updates', error)
      setManualCheck('failed')
    }
  }

  const offered = state && 'release' in state && state.release.version !== dismissed ? state : null
  return <UpdateContext.Provider value={{ state, manualCheck, check }}>
    {children}
    {offered && <UpdateDialog key={offered.release.version} state={offered} onDismiss={() => setDismissed(offered.release.version)} />}
  </UpdateContext.Provider>
}

/** Renders the current release version and manual check controls in General settings. */
export function AppUpdateSettings() {
  useLanguage()
  const updates = useContext(UpdateContext)
  if (!updates?.state) return null
  const { state, manualCheck, check } = updates
  const busy = state.phase === 'downloading' || state.phase === 'installing' || manualCheck === 'checking'
  return <fieldset className="settings-section">
    <legend>{tr('updates.title')}</legend>
    <div className="update-settings-row">
      <span>{tr('updates.currentVersion', { version: state.currentVersion })}</span>
      <button className="secondary-button" type="button" onClick={() => void check()} disabled={!state.enabled || busy}>
        {tr('updates.check')}
      </button>
    </div>
    <p className="settings-field-note" role="status">
      {!state.enabled && tr('updates.unavailable')}
      {(state.phase === 'checking' || manualCheck === 'checking') && tr('updates.checking')}
      {state.phase !== 'checking' && manualCheck === 'current' && tr('updates.current')}
      {state.phase !== 'checking' && manualCheck === 'failed' && tr('updates.checkFailed')}
    </p>
  </fieldset>
}

/** Displays release notes, download progress, and installation controls in a modal. */
function UpdateDialog({ state, onDismiss }: {
  state: Extract<UpdateState, { release: unknown }>
  onDismiss: () => void
}) {
  useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [commandFailed, setCommandFailed] = useState(false)
  const downloading = state.phase === 'downloading'
  const installing = state.phase === 'installing'

  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    return () => element.close()
  }, [])

  /** Invokes an update command and reports any IPC failure in the dialog. */
  async function run(command: () => Promise<void>): Promise<void> {
    setCommandFailed(false)
    try {
      await command()
    } catch (error) {
      console.error('Software update command failed', error)
      setCommandFailed(true)
    }
  }

  /** Cancels the transfer or dismisses the offer, depending on the current phase. */
  function cancel(): void {
    if (installing) return
    if (downloading) void run(() => window.remoteFiles.cancelUpdateDownload())
    else onDismiss()
  }

  return <dialog ref={dialog} className="modal update-dialog" aria-labelledby={titleId} onCancel={event => {
    event.preventDefault()
    cancel()
  }}>
    <header className="modal-heading">
      <h2 id={titleId}>{tr('updates.available')}</h2>
    </header>
    <div className="update-versions">
      <span>{tr('updates.currentVersion', { version: state.currentVersion })}</span>
      <strong>{tr('updates.newVersion', { version: state.release.version })}</strong>
    </div>
    <article className="md-article update-notes" tabIndex={0}>
      <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} disallowedElements={['a', 'img']} unwrapDisallowed>
        {state.release.notes}
      </ReactMarkdown>
    </article>
    {downloading && <div className="update-progress">
      <div role="status">
        {tr('updates.downloading')}
        {state.total !== null && state.total > 0
          ? ` ${Math.floor(state.received * 100 / state.total)}%`
          : state.received > 0 && ` ${(state.received / 1024 ** 2).toFixed(1)} MiB`}
      </div>
      <progress aria-label={tr('updates.downloading')} value={state.total ? state.received : undefined} max={state.total || undefined} />
    </div>}
    {installing && <p role="status">{tr('updates.installing')}</p>}
    {(state.phase === 'download-failed' || commandFailed) && <p className="confirmation-error" role="alert">{tr('updates.downloadFailed')}</p>}
    {state.phase === 'install-failed' && <p className="confirmation-error" role="alert">{tr('updates.installFailed')}</p>}
    <div className="modal-footer">
      <button type="button" className="secondary-button" autoFocus disabled={installing} onClick={cancel}>
        {downloading ? tr('updates.cancelDownload') : tr('updates.later')}
      </button>
      <button type="button" className="primary-button" disabled={downloading || installing}
        onClick={() => void run(() => window.remoteFiles.installUpdate(state.release.version))}>
        {tr('updates.install')}
      </button>
    </div>
  </dialog>
}
