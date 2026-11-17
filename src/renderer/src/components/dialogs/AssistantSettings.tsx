import { useEffect, useRef, useState } from 'react'
import { messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { AssistantProbeResult, AssistantProvider } from '@shared/types/assistant'
import { limitsSchema, providerInputSchema } from '@shared/assistant-settings'
import { AssistantPromptEditor } from './AssistantPromptEditor'
import type { SettingsPageProps } from './SettingsDialog'
import { SettingsSaveState, useSettingsNavigation, useSettingsSave } from './SettingsSaveState'

const empty = { name: '', baseUrl: '', apiKey: '', models: '', defaultModel: '', clearKey: false }
type ProviderDraft = typeof empty

/** Converts a public provider into an editable draft. @param provider Saved provider. @returns Draft with no exposed credential. */
function providerDraft(provider?: AssistantProvider): ProviderDraft {
  return provider
    ? {
        ...empty,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: provider.models.join('\n'),
        defaultModel: provider.defaultModel,
      }
    : { ...empty }
}

/** Edits assistant providers, execution limits and prompts. @param props Available server profiles for prompt overrides. @returns Assistant preference controls. */
export function AssistantSettings({ profiles }: Pick<SettingsPageProps, 'profiles'>) {
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const autosave = useSettingsSave()
  const navigate = useSettingsNavigation()
  const [promptProfileId, setPromptProfileId] = useState('')
  const [providers, setProviders] = useState<AssistantProvider[]>([])
  const savedProviders = useRef<AssistantProvider[]>([])
  const [selected, setSelected] = useState('')
  const selectedId = useRef('')
  const [draft, setDraft] = useState<ProviderDraft>({ ...empty })
  const draftRef = useRef(draft)
  const [limits, setLimits] = useState({ steps: '', modelTimeoutSeconds: '' })
  const savedLimits = useRef(limits)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [probe, setProbe] = useState<AssistantProbeResult>()
  const [retry, setRetry] = useState(0)
  const previous = providers.find((provider) => provider.id === selected)
  const models = [
    ...new Set(
      draft.models
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  const defaultModel = models.includes(draft.defaultModel) ? draft.defaultModel : (models[0] ?? '')

  useEffect(() => {
    let active = true
    void window.remoteFiles
      .assistant({ action: 'settings', input: undefined })
      .then((value) => {
        if (!active) return
        savedProviders.current = value.providers
        setProviders(value.providers)
        select(value.providers[0])
        const next = {
          steps: String(value.limits.steps),
          modelTimeoutSeconds: String(value.limits.modelTimeoutSeconds),
        }
        savedLimits.current = next
        setLimits(next)
        setLoaded(true)
      })
      .catch((reason) => {
        if (active) setError(renderMessage(messageFromUnknown(reason)))
      })
    return () => {
      active = false
    }
  }, [retry])

  /** Switches to a saved provider or a blank draft. @param provider Provider to edit. */
  function select(provider?: AssistantProvider): void {
    selectedId.current = provider?.id ?? ''
    setSelected(selectedId.current)
    draftRef.current = providerDraft(provider)
    setDraft(draftRef.current)
    setError('')
    setProbe(undefined)
  }

  /** Updates and automatically saves a complete provider. @param patch Changed inputs. */
  function updateProvider(patch: Partial<ProviderDraft>): void {
    if (!active.current) return
    const next = { ...draftRef.current, ...patch }
    draftRef.current = next
    setDraft(next)
    setProbe(undefined)
    const models = [
      ...new Set(
        next.models
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ]
    const input = {
      name: next.name,
      baseUrl: next.baseUrl,
      models,
      defaultModel: models.includes(next.defaultModel) ? next.defaultModel : (models[0] ?? ''),
      apiKey: next.clearKey ? null : next.apiKey.trim() || undefined,
    }
    const parsed = providerInputSchema.safeParse(input)
    autosave.schedule(
      'assistant.provider',
      async () => {
        if (!parsed.success) throw new Error(tr('preferences.invalidProvider'))
        const oldId = selectedId.current
        const provider = await window.remoteFiles.assistant({
          action: 'saveProvider',
          input: { ...parsed.data, id: oldId || undefined },
        })
        savedProviders.current = [...savedProviders.current.filter((value) => value.id !== oldId), provider]
        setProviders(savedProviders.current)
        selectedId.current = provider.id
        setSelected(provider.id)
        // Clear only the credential represented by this completed request.
        if (draftRef.current.apiKey === next.apiKey && draftRef.current.clearKey === next.clearKey) {
          draftRef.current = { ...draftRef.current, apiKey: '', clearKey: false }
          setDraft(draftRef.current)
        }
      },
      () => select(savedProviders.current.find((value) => value.id === selectedId.current)),
      parsed.success ? undefined : tr('preferences.invalidProvider'),
    )
  }

  /** Saves valid execution limits after editing. @param next Raw numeric inputs. */
  function updateLimits(next: typeof limits): void {
    setLimits(next)
    const parsed = limitsSchema.safeParse({
      steps: Number(next.steps),
      modelTimeoutSeconds: Number(next.modelTimeoutSeconds),
    })
    autosave.schedule(
      'assistant.limits',
      async () => {
        if (!parsed.success) throw new Error(tr('preferences.invalidLimits'))
        await window.remoteFiles.assistant({ action: 'limits', input: parsed.data })
        savedLimits.current = next
      },
      () => setLimits(savedLimits.current),
      parsed.success ? undefined : tr('preferences.invalidLimits'),
    )
  }

  /** Runs an explicit provider operation. @param action Network or deletion action. @returns Completion of the action. */
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(renderMessage(messageFromUnknown(reason)))
    } finally {
      setBusy(false)
    }
  }

  /** Removes the selected provider after confirmation. @returns Completion of deletion. */
  async function removeProvider(): Promise<void> {
    if (!selectedId.current || !window.confirm(tr('assistant.providerDeleteConfirm'))) return
    const id = selectedId.current
    await window.remoteFiles.assistant({ action: 'deleteProvider', input: { id } })
    savedProviders.current = savedProviders.current.filter((value) => value.id !== id)
    setProviders(savedProviders.current)
    select(savedProviders.current[0])
  }
  const credentials = {
    id: selected || undefined,
    baseUrl: draft.baseUrl,
    apiKey: draft.clearKey ? null : draft.apiKey.trim() || undefined,
  }
  return (
    <>
      {error && (
        <p role="alert" className="confirmation-error">
          {error}
          {!loaded && (
            <button className="text-button" onClick={() => setRetry((n) => n + 1)}>
              {tr('assistant.retry')}
            </button>
          )}
        </p>
      )}
      <fieldset className="settings-section" disabled={!loaded || busy}>
        <legend>{tr('assistant.providers')}</legend>
        <p className="settings-field-note">{tr('assistant.privacy')}</p>
        <label className="field">
          <span>{tr('assistant.providers')}</span>
          <select
            value={selected}
            onChange={(event) => {
              const id = event.target.value
              navigate(() => select(savedProviders.current.find((provider) => provider.id === id)))
            }}
          >
            <option value="">{tr('assistant.newProvider')}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr('assistant.providerName')}</span>
          <input
            maxLength={100}
            value={draft.name}
            onChange={(event) => updateProvider({ name: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{tr('assistant.baseUrl')}</span>
          <input
            type="url"
            maxLength={2048}
            placeholder="https://example.com/v1"
            value={draft.baseUrl}
            onChange={(event) => updateProvider({ baseUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{tr('assistant.key')}</span>
          <input
            type="password"
            autoComplete="new-password"
            maxLength={4096}
            placeholder={draft.clearKey ? tr('assistant.keyCleared') : previous?.hasKey ? tr('assistant.keepKey') : ''}
            value={draft.apiKey}
            onChange={(event) => updateProvider({ apiKey: event.target.value, clearKey: false })}
          />
        </label>
        {previous?.hasKey && (
          <label className="assistant-check">
            <input
              type="checkbox"
              checked={draft.clearKey}
              onChange={(event) => updateProvider({ clearKey: event.target.checked, apiKey: '' })}
            />
            {tr('assistant.clearKey')}
          </label>
        )}
        <label className="field">
          <span>{tr('assistant.models')}</span>
          <textarea
            maxLength={130000}
            value={draft.models}
            onChange={(event) => updateProvider({ models: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{tr('assistant.defaultModel')}</span>
          <select
            value={defaultModel}
            disabled={!models.length}
            onChange={(event) => updateProvider({ defaultModel: event.target.value })}
          >
            {models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </label>
        <div className="assistant-actions">
          <button
            type="button"
            className="text-button"
            disabled={!draft.baseUrl.trim()}
            onClick={() =>
              void run(async () => {
                const found = await window.remoteFiles.assistant({ action: 'models', input: credentials })
                if (!found.length) throw new Error(tr('assistant.modelListError'))
                updateProvider({ models: [...new Set([...models, ...found])].join('\n') })
              })
            }
          >
            {tr('assistant.fetchModels')}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!draft.baseUrl.trim() || !defaultModel}
            onClick={() =>
              void run(async () => {
                setProbe(
                  await window.remoteFiles.assistant({
                    action: 'probe',
                    input: { ...credentials, model: defaultModel },
                  }),
                )
              })
            }
          >
            {tr('assistant.probe')}
          </button>
          {selected && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                navigate(() => {
                  void run(removeProvider)
                })
              }
            >
              {tr('assistant.removeProvider')}
            </button>
          )}
        </div>
        {probe && (
          <div role="status" className="assistant-probe">
            {(
              [
                ['authentication', 'auth'],
                ['chat', 'chat'],
                ['stream', 'stream'],
                ['tools', 'tools'],
              ] as const
            ).map(([key, label]) => (
              <span key={key}>
                {tr(`assistant.${label}`)} · {tr(`assistant.${probe[key] ?? 'unverified'}`)}
              </span>
            ))}
            {probe.detail && <small>{probe.detail}</small>}
          </div>
        )}
        <SettingsSaveState id="assistant.provider" />
      </fieldset>
      <fieldset className="settings-section" disabled={!loaded}>
        <legend>{tr('assistant.limits')}</legend>
        <label className="field">
          <span>{tr('assistant.steps')}</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={limits.steps}
            onChange={(event) => updateLimits({ ...limits, steps: event.target.value })}
          />
        </label>
        <label className="field">
          <span>{tr('assistant.timeoutSeconds')}</span>
          <input
            type="number"
            min={5}
            max={300}
            value={limits.modelTimeoutSeconds}
            onChange={(event) => updateLimits({ ...limits, modelTimeoutSeconds: event.target.value })}
          />
        </label>
        <SettingsSaveState id="assistant.limits" />
      </fieldset>
      <section className="settings-section assistant-prompt-settings" aria-labelledby="assistant-prompt-title">
        <h4 id="assistant-prompt-title">{tr('preferences.assistantPrompt')}</h4>
        <label className="field">
          <span>{tr('preferences.promptScope')}</span>
          <select
            className="assistant-prompt-scope"
            value={promptProfileId}
            onChange={(event) => {
              const id = event.target.value
              navigate(() => setPromptProfileId(id))
            }}
          >
            <option value="">{tr('assistant.globalPrompt')}</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.username}@{profile.host}:{profile.port})
              </option>
            ))}
          </select>
        </label>
        <AssistantPromptEditor key={promptProfileId} profileId={promptProfileId || undefined} />
      </section>
    </>
  )
}
