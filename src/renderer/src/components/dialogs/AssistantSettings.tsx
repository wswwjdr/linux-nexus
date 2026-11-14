import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { renderMessage, messageFromUnknown, tr } from '@shared/i18n/messages'
import type { AssistantLimits, AssistantProbeResult, AssistantProvider, AssistantProviderInput } from '@shared/types/assistant'

import type { ServerProfile } from '@shared/types'
import { AssistantPromptEditor, type PromptEditorHandle } from './AssistantPromptEditor'

const empty = { name: '', baseUrl: '', apiKey: '', models: '', defaultModel: '', clearKey: false }

/** Edits providers, limits and prompts for profiles; navigationRef protects unsaved prompt edits. */
export function AssistantSettings({ profiles, navigationRef }: {
  profiles: ServerProfile[]; navigationRef: Ref<PromptEditorHandle>
}) {
  const globalPrompt = useRef<PromptEditorHandle>(null)
  const serverPrompt = useRef<PromptEditorHandle>(null)
  const [revision, setRevision] = useState(0)
  useImperativeHandle(navigationRef, () => ({
    /** Resolves pending prompt edits before invoking the requested settings navigation. */
    leave(next) {
      globalPrompt.current?.leave(() => serverPrompt.current?.leave(next))
    },
  }))
  const [providers, setProviders] = useState<AssistantProvider[]>([])
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState(empty)
  const [limits, setLimits] = useState<AssistantLimits>({ steps: 100, modelTimeoutSeconds: 120 })
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [probe, setProbe] = useState<AssistantProbeResult>()
  const previous = providers.find(({ id }) => id === selected)
  const models = [...new Set(draft.models.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))]
  const defaultModel = models.includes(draft.defaultModel) ? draft.defaultModel : (models[0] ?? '')
  const credentials = { id: selected || undefined, baseUrl: draft.baseUrl, apiKey: draft.clearKey ? null : draft.apiKey.trim() || undefined }

  useEffect(() => {
    let active = true
    void window.remoteFiles.assistant({ action: 'settings', input: undefined }).then((value) => {
      if (!active) return
      setProviders(value.providers)
      setLimits(value.limits)
      select(value.providers[0])
    }).catch((reason: unknown) => { if (active) setError(renderMessage(messageFromUnknown(reason))) })
    return () => { active = false }
  }, [])

  /** Loads a saved provider or opens a blank draft. */
  function select(provider?: AssistantProvider): void {
    setSelected(provider?.id ?? '')
    setDraft(provider ? { ...empty, name: provider.name, baseUrl: provider.baseUrl, models: provider.models.join('\n'), defaultModel: provider.defaultModel } : empty)
    setError('')
    setStatus('')
    setProbe(undefined)
  }

  /** Runs an asynchronous settings action and presents errors in the settings panel. */
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (reason) {
      setError(renderMessage(messageFromUnknown(reason)))
    } finally {
      setBusy(false)
    }
  }

  /** Saves the current provider draft and replaces its entry in the selector. */
  async function saveProvider(): Promise<void> {
    const input: AssistantProviderInput = { ...credentials, name: draft.name, models, defaultModel }
    const provider = await window.remoteFiles.assistant({ action: 'saveProvider', input })
    setProviders((items) => [...items.filter(({ id }) => id !== selected), provider])
    select(provider)
    setStatus(tr('assistant.saved'))
  }

  /** Removes the current saved provider after the user confirms. */
  async function removeProvider(): Promise<void> {
    if (!selected || !window.confirm(tr('assistant.providerDeleteConfirm'))) return
    await window.remoteFiles.assistant({ action: 'deleteProvider', input: { id: selected } })
    setProviders((items) => items.filter(({ id }) => id !== selected))
    select()
  }

  return <div className="settings-form-content assistant-settings">
    <fieldset className="settings-section" disabled={busy}>
      <legend>{tr('assistant.providers')}</legend>
      <p>{tr('assistant.privacy')}</p>
      <label className="field">
        <span>{tr('assistant.providers')}</span>
        <select value={selected} onChange={(event) => select(providers.find(({ id }) => id === event.target.value))}>
          <option value="">{tr('assistant.newProvider')}</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
      </label>
      <label className="field"><span>{tr('assistant.providerName')}</span><input maxLength={100} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label className="field"><span>{tr('assistant.baseUrl')}</span><input type="url" maxLength={2048} placeholder="https://example.com/v1" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
      <label className="field"><span>{tr('assistant.key')}</span>
        <input type="password" autoComplete="new-password" maxLength={4096} placeholder={draft.clearKey ? tr('assistant.keyCleared') : previous?.hasKey ? tr('assistant.keepKey') : ''}
          value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value, clearKey: false })} />
      </label>
      {previous?.hasKey && <label className="assistant-check"><input type="checkbox" checked={draft.clearKey} onChange={(event) => setDraft({ ...draft, clearKey: event.target.checked, apiKey: '' })} />{tr('assistant.clearKey')}</label>}
      <label className="field"><span>{tr('assistant.models')}</span><textarea value={draft.models} maxLength={130_000} onChange={(event) => setDraft({ ...draft, models: event.target.value })} /></label>
      <label className="field"><span>{tr('assistant.defaultModel')}</span>
        <select value={defaultModel} disabled={!models.length} onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}>
          {models.map((id) => <option key={id}>{id}</option>)}
        </select>
      </label>
      <div className="assistant-actions">
        <button type="button" className="text-button" disabled={!draft.baseUrl.trim()} onClick={() => void run(async () => {
          const found = await window.remoteFiles.assistant({ action: 'models', input: credentials })
          if (!found.length) throw new Error(tr('assistant.modelListError'))
          setDraft((value) => ({ ...value, models: [...new Set([...models, ...found])].join('\n') }))
        })}>{tr('assistant.fetchModels')}</button>
        <button type="button" className="text-button" disabled={!draft.baseUrl.trim() || !defaultModel} onClick={() => void run(async () => {
          setProbe(undefined)
          setProbe(await window.remoteFiles.assistant({ action: 'probe', input: { ...credentials, model: defaultModel } }))
        })}>{tr('assistant.probe')}</button>
        <button type="button" className="primary-button" disabled={!draft.name.trim() || !draft.baseUrl.trim() || !defaultModel} onClick={() => void run(saveProvider)}>{tr('assistant.save')}</button>
        {selected && <button type="button" className="text-button" onClick={() => void run(removeProvider)}>{tr('assistant.removeProvider')}</button>}
      </div>
      {probe && <div role="status" className="assistant-probe">
        {([['authentication', 'auth'], ['chat', 'chat'], ['stream', 'stream'], ['tools', 'tools']] as const).map(([key, label]) => (
          <span key={key}>{tr(`assistant.${label}`)} · {tr(`assistant.${probe[key] ?? 'unverified'}`)}</span>
        ))}
        {probe.detail && <small>{probe.detail}</small>}
      </div>}
    </fieldset>
    <fieldset className="settings-section" disabled={busy}>
      <legend>{tr('assistant.limits')}</legend>
      <label className="field"><span>{tr('assistant.steps')}</span>
        <input type="number" min={1} max={1000} value={limits.steps || ''} onChange={(event) => setLimits({ ...limits, steps: Number(event.target.value) })} />
      </label>
      <label className="field"><span>{tr('assistant.timeoutSeconds')}</span>
        <input type="number" min={5} max={300} value={limits.modelTimeoutSeconds || ''} onChange={(event) => setLimits({ ...limits, modelTimeoutSeconds: Number(event.target.value) })} />
      </label>
      <div className="assistant-actions"><button type="button" className="primary-button" onClick={() => void run(async () => {
        setLimits(await window.remoteFiles.assistant({ action: 'limits', input: limits }))
        setStatus(tr('assistant.saved'))
      })}>{tr('assistant.save')}</button></div>
    </fieldset>
    <AssistantPromptEditor editorRef={globalPrompt} onSaved={() => setRevision((value) => value + 1)} />
    <AssistantPromptEditor editorRef={serverPrompt} profiles={profiles} revision={revision} />
    {busy && <div role="status">{tr('assistant.running')}</div>}
    {status && <div role="status">{status}</div>}
    {error && <div role="alert" className="confirmation-error">{error}</div>}
  </div>
}
