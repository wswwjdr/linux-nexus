import { msg, LocalizedError } from '../../shared/i18n/messages'
import { safeStorage } from 'electron'
import { ipcMain } from './trusted-ipc'
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
      throw new LocalizedError(msg('errors.invalidServerConfigurationEnterTheConnectionDetailsAgain'))
    }
    if (!profile.name.trim() || !profile.host.trim() || !profile.username.trim()) {
      throw new LocalizedError(msg('errors.nameHostAddressAndUsernameAreRequired'))
    }
    if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
      throw new LocalizedError(msg('errors.sshPortMustBeAnIntegerFrom1To65535'))
    }
    if (password !== undefined && typeof password !== 'string') {
      throw new LocalizedError(msg('errors.invalidSshPasswordFormat'))
    }
    if (password && !safeStorage.isEncryptionAvailable()) {
      throw new LocalizedError(msg('errors.windowsCredentialEncryptionIsUnavailableCannotSaveThePasswordSecurely'))
    }

    const state = readState()
    const id = profile.id || randomUUID()
    const existingIndex = state.profiles.findIndex((candidate) => candidate.id === id)
    const previousProfile = state.profiles[existingIndex]
    const savedProfile: ServerProfile = {
      id,
      name: profile.name.trim(),
      host: profile.host.trim(),
      port: profile.port,
      username: profile.username.trim(),
      pinned: previousProfile?.pinned ?? false,
    }
    if (!password && !state.passwords[id]) throw new LocalizedError(msg('errors.enterAnSshPassword'))
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

  ipcMain.handle('profiles:set-pinned', (_event, profileId: string, pinned: boolean) => {
    if (typeof profileId !== 'string' || !profileId || typeof pinned !== 'boolean') {
      throw new LocalizedError(msg('errors.invalidServerPinState'))
    }
    const state = readState()
    const profile = state.profiles.find((candidate) => candidate.id === profileId)
    if (!profile) throw new LocalizedError(msg('errors.serverConfigurationNotFound'))
    profile.pinned = pinned
    writeState(state)
    return profile
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
