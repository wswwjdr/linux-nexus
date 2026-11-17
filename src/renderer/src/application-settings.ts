import { type SupportedLanguage, resolveLanguage } from '@shared/i18n/languages'
import { setLanguage } from '@shared/i18n/messages'
import type { AppBootstrap, AppSettings, RemoteFilesApi } from '@shared/types'

let system: SupportedLanguage

export async function loadApplicationBootstrap(api: Pick<RemoteFilesApi, 'getBootstrap' | 'onWindowExpanded'>): Promise<AppBootstrap> {
  let receivedWindowUpdate = false
  const applyWindowLayout = (expanded: boolean) => document.documentElement.toggleAttribute('data-window-expanded', expanded)
  api.onWindowExpanded((expanded) => {
    receivedWindowUpdate = true
    applyWindowLayout(expanded)
  })
  const bootstrap = await api.getBootstrap()
  if (!receivedWindowUpdate) applyWindowLayout(bootstrap.windowExpanded)
  return bootstrap
}

export function initializeApplication(bootstrap: Pick<AppBootstrap, 'settings' | 'systemLanguage'>): void {
  system = bootstrap.systemLanguage
  applyApplicationLanguage(bootstrap.settings)
}

/** Applies the saved display-language preference. @param settings Current application snapshot. */
export function applyApplicationLanguage(settings: AppSettings): void {
  setLanguage(resolveLanguage(settings.general.language, system))
}
