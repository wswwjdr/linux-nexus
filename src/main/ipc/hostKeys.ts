import { msg, LocalizedError } from '../../shared/i18n/messages'
import { ipcMain } from './trusted-ipc'
import type { TrustHostKeyInput } from '@shared/types'
import { endpointKey, profileFromState, readState, writeState } from '../state-store'

export function registerHostKeysIpc(): void {
  ipcMain.handle('host-key:trust', (_event, input: TrustHostKeyInput) => {
    if (typeof input?.profileId !== 'string' || !input.profileId
      || typeof input.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint)
      || (input.previousFingerprint !== undefined
        && (typeof input.previousFingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.previousFingerprint)))) {
      throw new LocalizedError(msg('errors.invalidServerFingerprintFormat'))
    }
    const state = readState()
    const profile = profileFromState(state, input.profileId)
    const key = endpointKey(profile)
    const currentFingerprint = state.hostKeys[key]
    if (input.previousFingerprint && currentFingerprint !== input.previousFingerprint) {
      throw new LocalizedError(msg('errors.hostFingerprintChangedAgainReconnectAndVerifyIt'))
    }
    if (!input.previousFingerprint && currentFingerprint && currentFingerprint !== input.fingerprint) {
      throw new LocalizedError(msg('errors.aTrustedHostFingerprintAlreadyExistsReconnectAndVerifyIt'))
    }
    state.hostKeys[key] = input.fingerprint
    writeState(state)
  })
}
