import { ipcMain, shell } from 'electron'
import type { AppSettingsPatch } from '@shared/types'
import { applyAppSettingsPatch } from '@shared/app-settings'
import { validateExternalUrl } from '@shared/external-url'
import { configurePerformanceMonitorInterval } from '../performance-monitor'
import { readAppSettings, readState, writeAppSettings } from '../state-store'
import { applyTheme } from '../theme'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => readAppSettings())
  ipcMain.handle('settings:update', (_event, input: AppSettingsPatch) => {
    const currentSettings = readAppSettings()
    const settings = applyAppSettingsPatch(currentSettings, input)
    if (settings.startupConnection
      && !readState().profiles.some((profile) => profile.id === settings.startupConnection?.profileId)) {
      throw new Error('启动连接所选服务器不存在')
    }
    const savedSettings = writeAppSettings(settings)
    applyTheme(savedSettings.theme)
    if (savedSettings.performanceSampleIntervalSeconds !== currentSettings.performanceSampleIntervalSeconds) {
      configurePerformanceMonitorInterval(savedSettings.performanceSampleIntervalSeconds)
    }
    return savedSettings
  })
  ipcMain.handle('shell:open-external', (_event, url: unknown) => shell.openExternal(validateExternalUrl(url)))
}
