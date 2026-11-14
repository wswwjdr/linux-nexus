import { useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { ServerProfile } from '@shared/types'
import type { AssistantPromptSettings } from '@shared/types/assistant'
import { useLanguage } from '@/i18n'
import { AssistantDecision } from './AssistantDecision'

export interface PromptEditorHandle {
  leave: (next: () => void) => void
}

/**
 * Edits the global prompt or a saved server's complete override.
 * @param props Optional profiles, navigation guard ref, and refresh hooks for inherited values.
 * @returns The settings section for the corresponding prompt scope.
 */
export function AssistantPromptEditor({ profiles, editorRef, revision, onSaved }: {
  profiles?: ServerProfile[]; editorRef: Ref<PromptEditorHandle>; revision?: number; onSaved?: () => void
}) {
  const language = useLanguage()
  const [selected, setSelected] = useState('')
  const profileId = profiles?.find(({ id }) => id === selected)?.id ?? profiles?.[0]?.id
  const [loaded, setLoaded] = useState<{ profileId?: string; settings: AssistantPromptSettings }>()
  const [edit, setEdit] = useState<{ profileId?: string; value: string | null }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState<{ next: () => void }>()
  const settings = loaded?.profileId === profileId ? loaded?.settings : undefined
  const stored = settings ? profiles ? settings.serverPrompt : settings.globalPrompt : null
  const draft = edit && edit.profileId === profileId ? edit.value : stored
  const dirty = !!settings && draft !== stored
  const inherited = settings ? (profiles ? settings.globalPrompt : null) ?? settings.defaultPrompt : ''
  const text = draft ?? inherited
  const title = tr(profiles ? 'assistant.serverPrompt' : 'assistant.globalPrompt')

  useEffect(() => {
    if (profiles && !profileId) return
    let active = true
    void window.remoteFiles.assistant({ action: 'promptSettings', input: { profileId } }).then((value) => {
      if (active) setLoaded({ profileId, settings: value })
    }).catch((reason: unknown) => {
      if (active) setError(renderMessage(messageFromUnknown(reason)))
    })
    return () => { active = false }
  }, [profileId, language, retry, revision, !!profiles])

  /** Persists value in this scope, then invokes next only if saving succeeded. */
  async function save(value: string | null, next?: () => void): Promise<void> {
    setError('')
    setSaved(false)
    setBusy(true)
    try {
      const result = await window.remoteFiles.assistant({ action: 'savePrompt', input: { profileId, prompt: value } })
      setLoaded({ profileId, settings: result })
      setEdit(undefined)
      setSaved(true)
      setPending(undefined)
      onSaved?.()
      next?.()
    } catch (reason) {
      setError(renderMessage(messageFromUnknown(reason)))
    } finally {
      setBusy(false)
    }
  }

  /** Asks how to handle the current draft before executing the supplied navigation. */
  function leave(next: () => void): void {
    if (busy) return
    if (dirty) setPending({ next })
    else next()
  }

  useImperativeHandle(editorRef, () => ({ leave }))

  return <fieldset className="settings-section assistant-prompt-settings">
    <legend>{title}</legend>
    {profiles && <label className="field command-alias-profile-field">
      <span>{tr('settings.server')}</span>
      <select value={profileId ?? ''} disabled={busy || !profiles.length} onChange={(event) => {
        const id = event.target.value
        leave(() => {
          setEdit(undefined)
          setSaved(false)
          setError('')
          setSelected(id)
        })
      }}>
        {profiles.map((profile) => <option key={profile.id} value={profile.id}>
          {profile.name} ({profile.username}@{profile.host}:{profile.port})
        </option>)}
      </select>
    </label>}
    {profiles && !profileId ? <p>{tr('settings.addAServerConnectionFirst')}</p> : <>
      {profiles && <label className="field">
        <span>{title}</span>
        <select value={draft === null ? 'inherit' : 'custom'} disabled={!settings || busy}
          onChange={(event) => {
            setEdit({ profileId, value: event.target.value === 'custom' ? text : null })
            setSaved(false)
          }}>
          <option value="inherit">{tr('assistant.inheritPrompt')}</option>
          <option value="custom">{tr('assistant.customPrompt')}</option>
        </select>
      </label>}
      <textarea aria-label={title} maxLength={32000} rows={8} value={text}
        disabled={!settings || busy} readOnly={!!profiles && draft === null}
        onChange={(event) => { setEdit({ profileId, value: event.target.value }); setSaved(false) }} />
      <div className="assistant-actions">
        <button type="button" className="primary-button" disabled={busy || !dirty || (draft !== null && !draft.trim())}
          onClick={() => void save(draft)}>{tr('assistant.save')}</button>
        {!profiles && <button type="button" className="text-button" disabled={!settings || busy || (stored === null && !dirty)}
          onClick={() => void save(null)}>{tr('assistant.resetPrompt')}</button>}
        {saved && <span role="status">{tr('assistant.saved')}</span>}
        {error && !settings && <button type="button" className="text-button" onClick={() => { setError(''); setRetry((n) => n + 1) }}>
          {tr('assistant.retry')}
        </button>}
      </div>
    </>}
    {error && !pending && <p role="alert" className="confirmation-error">{error}</p>}
    {pending && <AssistantDecision title={tr('assistant.unsavedPrompt')} onCancel={() => { if (!busy) setPending(undefined) }} actions={<>
      <button type="button" className="primary-button" disabled={busy || (draft !== null && !draft.trim())}
        onClick={() => void save(draft, pending.next)}>{tr('assistant.save')}</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => {
        setEdit(undefined)
        setPending(undefined)
        setError('')
        pending.next()
      }}>{tr('assistant.discard')}</button>
      <button type="button" className="text-button" data-initial-focus disabled={busy} onClick={() => setPending(undefined)}>{tr('assistant.cancel')}</button>
    </>}>{error && <p role="alert" className="confirmation-error">{error}</p>}</AssistantDecision>}
  </fieldset>
}
