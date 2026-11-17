import { systemLanguage } from '../language'

import { shell } from 'electron'
import { ipcMain } from './trusted-ipc'
import type { AppBootstrap } from '@shared/types'
import { validateExternalUrl } from '@shared/external-url'
import { readAppSettings } from '../settings-store'
import { updateAppSettings, completeSettingsExit } from '../settings-service'
import { getMainWindow } from '../runtime'
import { isWindowExpanded } from '../window-layout'

/** Registers validated settings, bootstrap and application-close endpoints. */
export function registerSettingsIpc(): void {
  ipcMain.handle(
    'app:bootstrap',
    (): AppBootstrap => ({
      settings: readAppSettings(),
      systemLanguage: systemLanguage(),
      windowExpanded: isWindowExpanded(getMainWindow()!),
    }),
  )
  ipcMain.handle('settings:complete-close', (_event, id: unknown, allow: unknown) => completeSettingsExit(id, allow))
  ipcMain.handle('settings:get', () => readAppSettings())
  ipcMain.handle('settings:update', (_event, input: unknown) => updateAppSettings(input))
  ipcMain.handle('shell:open-external', (_event, url: unknown) => shell.openExternal(validateExternalUrl(url)))
}
