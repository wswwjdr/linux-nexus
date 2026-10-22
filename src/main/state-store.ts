import { safeStorage } from 'electron'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AppSettings, CommandAliasSnapshot, PreviewLimits, ServerProfile } from '@shared/types'
import { DEFAULT_APP_SETTINGS, DEFAULT_PREVIEW_LIMITS, defaultAppSettings, validateAppSettings } from '@shared/app-settings'
import { normalizeStoredCommandAliases } from '@shared/command-aliases'
import { messageFromError } from './runtime'

export { DEFAULT_APP_SETTINGS, DEFAULT_PREVIEW_LIMITS, validateAppSettings }

export interface StoredState {
  profiles: ServerProfile[]
  passwords: Record<string, string>
  hostKeys: Record<string, string>
  commandAliases: Record<string, CommandAliasSnapshot>
}

let stateFile = ''
let settingsFile = ''

export function configureStateFiles(serverFile: string, preferencesFile: string): void {
  stateFile = serverFile
  settingsFile = preferencesFile
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function validateStoredState(value: unknown, verifyPasswordCiphertexts = false): StoredState {
  const legacyKeys = ['profiles', 'passwords', 'hostKeys']
  const keys = [...legacyKeys, 'commandAliases']
  if (!isRecord(value) || !(hasExactKeys(value, keys) || hasExactKeys(value, legacyKeys)) || !Array.isArray(value.profiles)
    || !isRecord(value.passwords) || !isRecord(value.hostKeys)) {
    throw new Error('服务器配置结构无效')
  }

  const profileIds = new Set<string>()
  for (const profile of value.profiles) {
    if (!isRecord(profile) || !hasExactKeys(profile, ['id', 'name', 'host', 'port', 'username'])
      || typeof profile.id !== 'string' || !profile.id
      || typeof profile.name !== 'string' || !profile.name.trim()
      || typeof profile.host !== 'string' || !profile.host.trim()
      || !Number.isInteger(profile.port) || (profile.port as number) < 1 || (profile.port as number) > 65535
      || typeof profile.username !== 'string' || !profile.username.trim()
      || profileIds.has(profile.id)) {
      throw new Error('服务器配置中包含无效或重复的连接')
    }
    profileIds.add(profile.id)
  }

  for (const [profileId, password] of Object.entries(value.passwords)) {
    if (!profileId || typeof password !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(password) || !password) {
      throw new Error('服务器密码数据结构无效')
    }
    const ciphertext = Buffer.from(password, 'base64')
    if (ciphertext.toString('base64') !== password) throw new Error('服务器密码数据结构无效')
    if (verifyPasswordCiphertexts && safeStorage.isEncryptionAvailable()) {
      try {
        safeStorage.decryptString(ciphertext)
      } catch {
        throw new Error('服务器密码密文无效：' + profileId)
      }
    }
  }
  for (const [endpoint, fingerprint] of Object.entries(value.hostKeys)) {
    if (!endpoint || typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
      throw new Error('服务器指纹数据结构无效')
    }
  }

  const commandAliases = normalizeStoredCommandAliases(value.commandAliases, profileIds)

  return { ...value, commandAliases } as unknown as StoredState
}

function parseJsonFile(filePath: string): unknown {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error('无法读取配置文件 ' + filePath + '：' + messageFromError(error))
  }
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error('配置文件格式无效 ' + filePath + '：' + messageFromError(error))
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const temporaryFile = filePath + '.' + process.pid + '.' + randomUUID() + '.tmp'
  let descriptor: number | null = null
  try {
    descriptor = openSync(temporaryFile, 'wx', 0o600)
    writeFileSync(descriptor, JSON.stringify(value, null, 2), { encoding: 'utf8' })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryFile, filePath)
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor) } catch { /* Preserve the original write error. */ }
    }
    try { unlinkSync(temporaryFile) } catch { /* The temporary file may not exist. */ }
    throw new Error('无法安全保存配置文件 ' + filePath + '：' + messageFromError(error))
  }
}

export function readState(verifyPasswordCiphertexts = false): StoredState {
  if (!existsSync(stateFile)) return { profiles: [], passwords: {}, hostKeys: {}, commandAliases: {} }
  try {
    return validateStoredState(parseJsonFile(stateFile), verifyPasswordCiphertexts)
  } catch (error) {
    throw new Error('服务器配置无效（' + stateFile + '）：' + messageFromError(error))
  }
}

export function writeState(state: StoredState): void {
  atomicWriteJson(stateFile, state)
}

export function readAppSettings(): AppSettings {
  if (!existsSync(settingsFile)) {
    const defaults = defaultAppSettings()
    atomicWriteJson(settingsFile, defaults)
    return defaults
  }
  try {
    return validateAppSettings(parseJsonFile(settingsFile))
  } catch (error) {
    throw new Error('应用设置无效（' + settingsFile + '）：' + messageFromError(error))
  }
}

export function writeAppSettings(settings: unknown): AppSettings {
  const validated = validateAppSettings(settings)
  atomicWriteJson(settingsFile, validated)
  return validated
}

export function readPreviewLimits(): PreviewLimits {
  const { startupConnection: _startupConnection, transferFileConcurrency: _transferFileConcurrency, previewExtensions: _previewExtensions, ...limits } = readAppSettings()
  return limits
}

export function writePreviewLimits(limits: unknown): PreviewLimits {
  const appSettings = validateAppSettings({ ...readAppSettings(), ...(limits as Record<string, unknown>) })
  const { startupConnection: _startupConnection, transferFileConcurrency: _transferFileConcurrency, previewExtensions: _previewExtensions, ...validatedLimits } = appSettings
  atomicWriteJson(settingsFile, appSettings)
  return validatedLimits
}

export function endpointKey(profile: ServerProfile): string {
  return profile.host.toLowerCase() + ':' + profile.port
}

export function profileFromState(state: StoredState, profileId: string): ServerProfile {
  const profile = state.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error('找不到服务器配置')
  return profile
}

export function passwordFor(state: StoredState, profileId: string): string {
  const encryptedPassword = state.passwords[profileId]
  if (!encryptedPassword) throw new Error('此服务器没有保存密码，请编辑连接配置并填写密码')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，密码未能读取')
  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}
