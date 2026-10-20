import { safeStorage } from 'electron'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { AppSettings, CommandAliasSnapshot, PreviewLimits, ServerProfile, SessionKind, StartupConnection } from '@shared/types'
import { normalizeStoredCommandAliases } from '@shared/command-aliases'
import { messageFromError } from './runtime'

export interface StoredState {
  profiles: ServerProfile[]
  passwords: Record<string, string>
  hostKeys: Record<string, string>
  commandAliases: Record<string, CommandAliasSnapshot>
}

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  textMiB: 5,
  imageMiB: 100,
  audioMiB: 100,
  videoMiB: 100,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  ...DEFAULT_PREVIEW_LIMITS,
  startupConnection: null,
  transferFileConcurrency: 4,
}

const MAX_PREVIEW_LIMIT_MIB = 1024
const MIN_TRANSFER_FILE_CONCURRENCY = 1
const MAX_TRANSFER_FILE_CONCURRENCY = 16

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

export function validateAppSettings(value: unknown): AppSettings {
  const keys = Object.keys(DEFAULT_PREVIEW_LIMITS)
  if (!isRecord(value) || keys.some((key) => !Object.hasOwn(value, key))
    || !Object.hasOwn(value, 'transferFileConcurrency')
    || Object.keys(value).some((key) => !keys.includes(key) && key !== 'startupConnection' && key !== 'transferFileConcurrency')
    || (Object.hasOwn(value, 'startupConnection') && Object.keys(value).length !== keys.length + 2)
    || (!Object.hasOwn(value, 'startupConnection') && Object.keys(value).length !== keys.length + 1)) {
    throw new Error('应用设置结构无效')
  }
  for (const key of keys) {
    const limit = value[key]
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PREVIEW_LIMIT_MIB) {
      throw new Error('预览设置 ' + key + ' 必须是 1 到 ' + MAX_PREVIEW_LIMIT_MIB + ' 之间的整数')
    }
  }
  const transferFileConcurrency = value.transferFileConcurrency
  if (typeof transferFileConcurrency !== 'number' || !Number.isInteger(transferFileConcurrency)
    || transferFileConcurrency < MIN_TRANSFER_FILE_CONCURRENCY || transferFileConcurrency > MAX_TRANSFER_FILE_CONCURRENCY) {
    throw new Error('同时传输文件数必须是 1 到 16 之间的整数')
  }
  let startupConnection: StartupConnection | null = null
  if (Object.hasOwn(value, 'startupConnection') && value.startupConnection !== null) {
    const connection = value.startupConnection
    if (!isRecord(connection) || !hasExactKeys(connection, ['profileId', 'kind'])
      || typeof connection.profileId !== 'string' || !connection.profileId
      || (connection.kind !== 'sftp' && connection.kind !== 'terminal')) {
      throw new Error('启动连接设置无效')
    }
    startupConnection = { profileId: connection.profileId, kind: connection.kind as SessionKind }
  }
  return { ...value as unknown as PreviewLimits, startupConnection, transferFileConcurrency }
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
    atomicWriteJson(settingsFile, DEFAULT_APP_SETTINGS)
    return { ...DEFAULT_APP_SETTINGS }
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
  const { startupConnection: _startupConnection, transferFileConcurrency: _transferFileConcurrency, ...limits } = readAppSettings()
  return limits
}

export function writePreviewLimits(limits: unknown): PreviewLimits {
  const appSettings = validateAppSettings({ ...readAppSettings(), ...(limits as Record<string, unknown>) })
  const { startupConnection: _startupConnection, transferFileConcurrency: _transferFileConcurrency, ...validatedLimits } = appSettings
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
