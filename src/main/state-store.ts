import { msg, LocalizedError } from '../shared/i18n/messages'
import { safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { CommandAliasSnapshot, ServerProfile } from '@shared/types'
import { atomicWriteJson } from './json-store'
import { configureSettingsStore } from './settings-store'
import { normalizeStoredCommandAliases } from '@shared/command-aliases'
import { messageFromError } from './runtime'


export interface StoredState {
  profiles: ServerProfile[]
  passwords: Record<string, string>
  hostKeys: Record<string, string>
  commandAliases: Record<string, CommandAliasSnapshot>
}

let stateFile = ''

/** Configures server and application storage. @param serverFile Server state path. @param preferencesFile Application preferences path. */
export function configureStateFiles(serverFile: string, preferencesFile: string): void {
  stateFile = serverFile
  configureSettingsStore(preferencesFile)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function validateStoredState(value: unknown, verifyPasswordCiphertexts = false): StoredState {
  const keys = ['profiles', 'passwords', 'hostKeys', 'commandAliases']
  if (!isRecord(value) || !hasExactKeys(value, keys) || !Array.isArray(value.profiles)
    || !isRecord(value.passwords) || !isRecord(value.hostKeys)) {
    throw new LocalizedError(msg('errors.invalidServerConfigurationStructure'))
  }

  const profileIds = new Set<string>()
  for (const profile of value.profiles) {
    if (!isRecord(profile) || !hasExactKeys(profile, ['id', 'name', 'host', 'port', 'username', 'pinned'])
      || typeof profile.id !== 'string' || !profile.id
      || typeof profile.name !== 'string' || !profile.name.trim()
      || typeof profile.host !== 'string' || !profile.host.trim()
      || !Number.isInteger(profile.port) || (profile.port as number) < 1 || (profile.port as number) > 65535
      || typeof profile.username !== 'string' || !profile.username.trim()
      || typeof profile.pinned !== 'boolean'
      || profileIds.has(profile.id)) {
      throw new LocalizedError(msg('errors.serverConfigurationContainsInvalidOrDuplicateConnections'))
    }
    profileIds.add(profile.id)
  }

  for (const [profileId, password] of Object.entries(value.passwords)) {
    if (!profileId || typeof password !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(password) || !password) {
      throw new LocalizedError(msg('errors.invalidServerPasswordDataStructure'))
    }
    const ciphertext = Buffer.from(password, 'base64')
    if (ciphertext.toString('base64') !== password) throw new LocalizedError(msg('errors.invalidServerPasswordDataStructure'))
    if (verifyPasswordCiphertexts && safeStorage.isEncryptionAvailable()) {
      try {
        safeStorage.decryptString(ciphertext)
      } catch {
        throw new LocalizedError(msg('errors.invalidServerPasswordCiphertext', { "profileId": profileId }))
      }
    }
  }
  for (const [endpoint, fingerprint] of Object.entries(value.hostKeys)) {
    if (!endpoint || typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
      throw new LocalizedError(msg('errors.invalidServerFingerprintDataStructure'))
    }
  }

  const commandAliases = normalizeStoredCommandAliases(value.commandAliases, profileIds)

  return { ...value, commandAliases } as unknown as StoredState
}

/** Reads and parses configuration JSON at filePath, or reports the read failure. */
export function parseJsonFile(filePath: string): unknown {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new LocalizedError(msg('errors.cannotReadConfigurationFile', { "filePath": filePath, "value2": messageFromError(error) }))
  }
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new LocalizedError(msg('errors.invalidConfigurationFileFormat', { "filePath": filePath, "value2": messageFromError(error) }))
  }
}

export function readState(verifyPasswordCiphertexts = false): StoredState {
  if (!existsSync(stateFile)) return { profiles: [], passwords: {}, hostKeys: {}, commandAliases: {} }
  try {
    return validateStoredState(parseJsonFile(stateFile), verifyPasswordCiphertexts)
  } catch (error) {
    throw new LocalizedError(msg('errors.invalidServerConfiguration2', { "stateFile": stateFile, "value2": messageFromError(error) }))
  }
}

export function writeState(state: StoredState): void {
  atomicWriteJson(stateFile, state)
}

/** Returns persisted archive preparation keys for the configured workspace. */
function readArchivePreparation(): Record<string, string> {
  const path = join(dirname(stateFile), 'archive-preparation.json')
  if (!existsSync(path)) return Object.create(null)
  const value = parseJsonFile(path)
  if (!isRecord(value) || !Object.values(value).every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))) {
    throw new LocalizedError(msg('errors.invalidServerConfigurationStructure'))
  }
  return Object.assign(Object.create(null), value)
}

/** Returns the first-visit key for this profile's address, account and verified SSH identity. */
export function archivePreparationKey(profile: ServerProfile, fingerprint: string): string {
  return createHash('sha256').update(JSON.stringify([profile.host.toLowerCase(), profile.port, profile.username, fingerprint])).digest('hex')
}

/** Reports whether this profile already completed archive preparation for `key`. */
export function archivePreparationSeen(profileId: string, key: string): boolean {
  return readArchivePreparation()[profileId] === key
}

/** Records or removes the archive preparation key for `profileId`. */
export function saveArchivePreparation(profileId: string, key?: string): void {
  const values = readArchivePreparation()
  if (values[profileId] === key) return
  if (key) values[profileId] = key
  else delete values[profileId]
  atomicWriteJson(join(dirname(stateFile), 'archive-preparation.json'), values)
}

export function endpointKey(profile: ServerProfile): string {
  return profile.host.toLowerCase() + ':' + profile.port
}

export function profileFromState(state: StoredState, profileId: string): ServerProfile {
  const profile = state.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new LocalizedError(msg('errors.serverConfigurationNotFound'))
  return profile
}

export function passwordFor(state: StoredState, profileId: string): string {
  const encryptedPassword = state.passwords[profileId]
  if (!encryptedPassword) throw new LocalizedError(msg('errors.noPasswordIsSavedForThisServerEditTheConnection'))
  if (!safeStorage.isEncryptionAvailable()) throw new LocalizedError(msg('errors.windowsCredentialEncryptionIsUnavailableCannotReadThePassword'))
  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}
