import { ipcMain } from 'electron'
import type { TrustHostKeyInput } from '@shared/types'
import { endpointKey, profileFromState, readState, writeState } from '../state-store'

export function registerHostKeysIpc(): void {
  ipcMain.handle('host-key:trust', (_event, input: TrustHostKeyInput) => {
    if (typeof input?.profileId !== 'string' || !input.profileId
      || typeof input.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.fingerprint)
      || (input.previousFingerprint !== undefined
        && (typeof input.previousFingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(input.previousFingerprint)))) {
      throw new Error('服务器指纹格式无效')
    }
    const state = readState()
    const profile = profileFromState(state, input.profileId)
    const key = endpointKey(profile)
    const currentFingerprint = state.hostKeys[key]
    if (input.previousFingerprint && currentFingerprint !== input.previousFingerprint) {
      throw new Error('主机指纹已再次变化，请重新连接并核对')
    }
    if (!input.previousFingerprint && currentFingerprint && currentFingerprint !== input.fingerprint) {
      throw new Error('已有受信任的主机指纹，请重新连接并核对')
    }
    state.hostKeys[key] = input.fingerprint
    writeState(state)
  })
}
