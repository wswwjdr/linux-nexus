import { useEffect, useRef, useState } from 'react'
import { messageFromUnknown, renderMessage, tr } from '@shared/i18n/messages'
import type { AssistantPromptSettings } from '@shared/types/assistant'
import { assistantPromptSchema } from '@shared/assistant-settings'
import { useLanguage } from '@/i18n'
import { SettingsSaveState, useSettingsSave } from './SettingsSaveState'

/** Edits a global prompt or one server override. @param props Optional server ID. @returns Automatic prompt editor. */
export function AssistantPromptEditor({ profileId }: { profileId?: string }) {
  const language = useLanguage()
  const autosave = useSettingsSave()
  const [settings, setSettings] = useState<AssistantPromptSettings>()
  const [draft, setDraft] = useState<string | null>(null)
  const saved = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const id = profileId ? `prompt.${profileId}` : 'prompt.global'
  const title = tr(profileId ? 'assistant.serverPrompt' : 'assistant.globalPrompt')
  useEffect(() => {
    let active = true
    void window.remoteFiles
      .assistant({ action: 'promptSettings', input: { profileId } })
      .then((value) => {
        if (!active) return
        setSettings(value)
        saved.current = profileId ? value.serverPrompt : value.globalPrompt
        setDraft(saved.current)
      })
      .catch((reason) => {
        if (active) setError(renderMessage(messageFromUnknown(reason)))
      })
    return () => {
      active = false
    }
  }, [profileId, language, retry])

  /** Schedules an override or inheritance change. @param value Custom prompt or inherited mode. */
  function update(value: string | null): void {
    setDraft(value)
    const valid = assistantPromptSchema.safeParse(value).success
    autosave.schedule(
      id,
      async () => {
        const result = await window.remoteFiles.assistant({ action: 'savePrompt', input: { profileId, prompt: value } })
        saved.current = value
        setSettings(result)
      },
      () => setDraft(saved.current),
      valid ? undefined : tr('preferences.invalidPrompt'),
    )
  }
  const inherited = settings ? ((profileId ? settings.globalPrompt : null) ?? settings.defaultPrompt) : ''
  return (
    <>
      {error && (
        <p role="alert">
          {error}
          <button
            className="text-button"
            onClick={() => {
              setError('')
              setRetry((n) => n + 1)
            }}
          >
            {tr('assistant.retry')}
          </button>
        </p>
      )}
      <label className="field">
        <span>{tr('preferences.promptSource')}</span>
        <select
          disabled={!settings}
          value={draft === null ? 'inherit' : 'custom'}
          onChange={(event) => update(event.target.value === 'inherit' ? null : inherited)}
        >
          <option value="inherit">{tr(profileId ? 'assistant.inheritPrompt' : 'preferences.defaultPrompt')}</option>
          <option value="custom">{tr('assistant.customPrompt')}</option>
        </select>
      </label>
      <textarea
        aria-label={title}
        maxLength={32000}
        rows={10}
        value={draft ?? inherited}
        disabled={!settings}
        readOnly={draft === null}
        onChange={(event) => update(event.target.value)}
      />
      <SettingsSaveState id={id} />
    </>
  )
}
