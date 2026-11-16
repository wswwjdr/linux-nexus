import { useEffect, useState } from 'react'
import { messageFromUnknown, renderMessage, tr, type MessageValue } from '@shared/i18n/messages'
import type { UpdateState } from '@shared/types/updates'

/** Displays the installed version and the available action for the current update stage. */
export function UpdateSettings() {
  const transport = window.appUpdates
  const [state, setState] = useState<UpdateState>()
  const [failure, setFailure] = useState<MessageValue>()

  useEffect(() => {
    if (!transport) return
    let disposed = false
    let receivedUpdate = false
    const unsubscribe = transport.subscribe((next) => {
      receivedUpdate = true
      setState(next)
    })
    void transport.snapshot().then(result => {
      if (disposed || receivedUpdate) return
      if (result.ok) setState(result.value)
      else setFailure(result.error)
    }).catch(error => {
      if (!disposed && !receivedUpdate) setFailure(messageFromUnknown(error))
    })
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [transport])

  /**
   * Invokes the selected update action and reports transport errors.
   * @param action Update command exposed by the preload.
   */
  async function invoke(action: 'check' | 'download' | 'install'): Promise<void> {
    if (!transport) return
    setFailure(undefined)
    try {
      const result = await transport[action]()
      if (!result.ok) setFailure(result.error)
    } catch (error) {
      setFailure(messageFromUnknown(error))
    }
  }

  if (!state && !failure) return null
  const status = state ? updateStatusText(state) : undefined
  const error = failure ?? state?.error
  const busy = state?.status === 'checking' || state?.status === 'downloading' || state?.status === 'installing'
  return (
    <fieldset className="settings-section">
      <legend>{tr('updates.title')}</legend>
      {state && <div>{tr('updates.version', { version: state.currentVersion })}</div>}
      {status && <p className="settings-field-note" role="status">{status}</p>}
      {state?.status === 'downloading' && <progress max={100} value={state.progress} aria-label={status} />}
      {error && <p className="settings-performance-error" role="alert">{renderMessage(error)}</p>}
      {state && state.status !== 'disabled' && (
        <div className="assistant-actions">
          {state.status !== 'ready' && (
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void invoke('check')}>{tr('updates.check')}</button>
          )}
          {state.status === 'available' && (
            <button type="button" className="secondary-button" onClick={() => void invoke('download')}>{tr('updates.download')}</button>
          )}
          {state.status === 'ready' && (
            <button type="button" className="secondary-button" onClick={() => void invoke('install')}>{tr('updates.restartAndInstall')}</button>
          )}
        </div>
      )}
    </fieldset>
  )
}

/**
 * Formats the current stage in the active language.
 * @param state Update state sent by the main process.
 * @returns Status text when the stage has a message.
 */
function updateStatusText(state: UpdateState): string | undefined {
  switch (state.status) {
    case 'disabled': return tr('updates.disabled')
    case 'checking': return tr('updates.checking')
    case 'current': return tr('updates.current')
    case 'available': return tr('updates.available', { version: state.nextVersion ?? '' })
    case 'downloading': return tr('updates.downloading', { version: state.nextVersion ?? '', progress: state.progress ?? 0 })
    case 'ready': return tr('updates.ready', { version: state.nextVersion ?? '' })
    case 'installing': return tr('updates.installing')
  }
}
