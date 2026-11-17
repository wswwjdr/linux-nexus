import { createContext, useContext, useSyncExternalStore } from 'react'
import { tr } from '@shared/i18n/messages'
import { SettingsAutosave } from '@/settings-autosave'

export const SettingsNavigationContext = createContext<((next: () => void) => void) | null>(null)

/** Returns the shared navigation guard. @returns Guarded navigation callback. */
export function useSettingsNavigation(): (next: () => void) => void {
  const navigate = useContext(SettingsNavigationContext)
  if (!navigate) throw new Error('Settings navigation context is missing')
  return navigate
}

export const SettingsSaveContext = createContext<SettingsAutosave | null>(null)

/** Returns the settings save coordinator. @returns The active coordinator. */
export function useSettingsSave(): SettingsAutosave {
  const value = useContext(SettingsSaveContext)
  if (!value) throw new Error('Settings save context is missing')
  return value
}

/** Shows save feedback and retry for an editor. @param props Editor identity. @returns Save status. */
export function SettingsSaveState({ id }: { id?: string }) {
  const coordinator = useSettingsSave()
  const states = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot)
  const entries = Object.entries(states).filter(([key]) => !id || key === id || key.startsWith(id + '.'))
  if (!entries.length) return <p className="settings-save-state">{tr('preferences.autoSave')}</p>
  const problem = entries.find(([, state]) => state.status === 'failed' || state.status === 'invalid')?.[1]
  const busy = entries.some(([, state]) => state.status === 'pending' || state.status === 'saving')
  return (
    <div className="settings-save-state" role={problem ? 'alert' : 'status'}>
      {problem?.error ?? tr(busy ? 'preferences.saving' : 'preferences.saved')}
      {problem?.status === 'failed' && (
        <button type="button" className="text-button" onClick={() => void coordinator.flush()}>
          {tr('assistant.retry')}
        </button>
      )}
    </div>
  )
}
