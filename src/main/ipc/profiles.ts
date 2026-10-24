import { ipcMain, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import type { SaveProfileInput, ServerProfile } from '@shared/types'
import { connectionIdentityChanged } from '@shared/command-aliases'
import { stopSessionsForProfile } from '../connections'
import { readAppSettings, readState, writeAppSettings, writeState } from '../state-store'

export function registerProfilesIpc(): void {
  ipcMain.handle('profiles:list', () => readState().profiles)
  ipcMain.handle('profiles:save', async (_event, input: SaveProfileInput) => {
    const { profile, password } = input
    if (
      typeof profile?.id !== 'string' ||
      typeof profile?.name !== 'string' ||
      typeof profile.host !== 'string' ||
      typeof profile.username !== 'string'
    ) {
      throw new Error('服务器配置格式无效，请重新填写连接信息')
    }
    if (!profile.name.trim() || !profile.host.trim() || !profile.username.trim()) {
      throw new Error('名称、主机地址和用户名不能为空')
    }
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
      throw new Error('SSH 端口必须是 1 到 65535 之间的整数')
    }
    if (password !== undefined && typeof password !== 'string') {
      throw new Error('SSH 密码格式无效')
    }
    if (password && !safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 凭据加密不可用，不能安全保存密码')
    }

    const state = readState()
    const id = profile.id || randomUUID()
    const savedProfile: ServerProfile = {
      id,
      name: profile.name.trim(),
      host: profile.host.trim(),
      port: profile.port,
      username: profile.username.trim(),
    }
    const existingIndex = state.profiles.findIndex((candidate) => candidate.id === id)
    const previousProfile = state.profiles[existingIndex]
    if (!password && !state.passwords[id]) throw new Error('请填写 SSH 密码')
    if (existingIndex === -1) state.profiles.push(savedProfile)
    else {
      state.profiles[existingIndex] = savedProfile
      if (connectionIdentityChanged(previousProfile, savedProfile)) {
        delete state.commandAliases[id]
      }
    }
    if (password) state.passwords[id] = safeStorage.encryptString(password).toString('base64')
    writeState(state)
    stopSessionsForProfile(id)
    return savedProfile
  })

  ipcMain.handle('profiles:delete', (_event, profileId: string) => {
    stopSessionsForProfile(profileId)
    const state = readState()
    const settings = readAppSettings()
    if (settings.startupConnection?.profileId === profileId) {
      writeAppSettings({ ...settings, startupConnection: null })
    }
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    delete state.passwords[profileId]
    delete state.commandAliases[profileId]
    writeState(state)
  })
}
