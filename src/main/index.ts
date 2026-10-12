import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rename, unlink } from 'node:fs/promises'
import { basename, join, posix } from 'node:path'
import { Client, type SFTPWrapper } from 'ssh2'
import type {
  ConnectResult,
  RemoteEntry,
  SaveProfileInput,
  ServerProfile,
  TrustHostKeyInput,
} from '@shared/types'

interface StoredState {
  profiles: ServerProfile[]
  passwords: Record<string, string>
  hostKeys: Record<string, string>
}

interface ActiveSession {
  client: Client
  sftp: SFTPWrapper
  profileId: string
}

const sessions = new Map<string, ActiveSession>()
let mainWindow: BrowserWindow | null = null
let stateFile = ''

function readState(): StoredState {
  if (!existsSync(stateFile)) return { profiles: [], passwords: {}, hostKeys: {} }
  return JSON.parse(readFileSync(stateFile, 'utf8')) as StoredState
}

function writeState(state: StoredState): void {
  const temporaryFile = `${stateFile}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporaryFile, stateFile)
}

function endpointKey(profile: ServerProfile): string {
  return `${profile.host.toLowerCase()}:${profile.port}`
}

function profileFromState(state: StoredState, profileId: string): ServerProfile {
  const profile = state.profiles.find((candidate) => candidate.id === profileId)
  if (!profile) throw new Error('找不到服务器配置')
  return profile
}

function passwordFor(state: StoredState, profileId: string): string {
  const encryptedPassword = state.passwords[profileId]
  if (!encryptedPassword) throw new Error('此服务器没有保存密码，请编辑连接配置并填写密码')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows 凭据加密不可用，密码未能读取')
  return safeStorage.decryptString(Buffer.from(encryptedPassword, 'base64'))
}

function sendConnectionClosed(profileId: string, message: string): void {
  if (!mainWindow?.isDestroyed()) {
    mainWindow?.webContents.send('connection:closed', { profileId, message })
  }
}

function stopSession(profileId: string): void {
  const session = sessions.get(profileId)
  if (!session) return
  sessions.delete(profileId)
  session.client.end()
}

function connectProfile(profileId: string): Promise<ConnectResult> {
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)
  stopSession(profileId)

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    let keyIssue: ConnectResult | null = null

    const finish = (result: ConnectResult) => {
      if (settled) return
      settled = true
      if (!result.ok) client.end()
      resolve(result)
    }

    client.on('ready', () => {
      client.sftp((error, sftp) => {
        if (error) {
          finish({ ok: false, reason: 'sftp-unavailable', message: error.message })
          return
        }
        sessions.set(profileId, { client, sftp, profileId })
        sftp.realpath('.', (pathError, remotePath) => {
          finish({ ok: true, path: pathError || !remotePath ? '/' : remotePath })
        })
      })
    })

    client.on('error', (error: Error & { level?: string }) => {
      if (settled) {
        if (sessions.get(profileId)?.client === client) {
          sessions.delete(profileId)
          sendConnectionClosed(profileId, error.message)
        }
        return
      }
      if (keyIssue) {
        finish(keyIssue)
        return
      }
      const message = error.message || '连接失败'
      const lowerMessage = message.toLowerCase()
      if (error.level === 'client-authentication' || lowerMessage.includes('authentication')) {
        finish({ ok: false, reason: 'auth-failed', message: '用户名或密码错误，或服务器拒绝了密码认证' })
      } else if (/timed out|econnrefused|ehostunreach|enetunreach|enotfound|socket hang up/i.test(message)) {
        finish({ ok: false, reason: 'unreachable', message: '无法连接服务器，请检查地址、端口和网络或 VPN' })
      } else {
        finish({ ok: false, reason: 'other', message })
      }
    })

    client.on('close', () => {
      if (sessions.get(profileId)?.client === client) {
        sessions.delete(profileId)
        sendConnectionClosed(profileId, 'SSH 连接已关闭')
      }
      if (!settled) finish({ ok: false, reason: 'unreachable', message: '连接在完成前关闭' })
    })

    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password,
      readyTimeout: 15000,
      hostVerifier: (hash, callback) => {
        const fingerprint = `SHA256:${createHash('sha256').update(hash).digest('base64').replace(/=+$/, '')}`
        const previousFingerprint = readState().hostKeys[endpointKey(profile)]
        if (previousFingerprint === fingerprint) {
          callback(true)
          return
        }
        keyIssue = previousFingerprint
          ? { ok: false, reason: 'host-key-changed', fingerprint, previousFingerprint }
          : { ok: false, reason: 'host-key-unknown', fingerprint }
        callback(false)
      },
    })
  })
}

function listDirectory(profileId: string, remotePath: string): Promise<RemoteEntry[]> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const normalizedPath = posix.resolve('/', remotePath || '/')

  return new Promise((resolve, reject) => {
    session.sftp.readdir(normalizedPath, (error, entries) => {
      if (error) {
        reject(new Error(error.message))
        return
      }
      const result = entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry): RemoteEntry => {
          const mode = entry.attrs.mode ?? 0
          const kind = mode & 0o170000
          const type: RemoteEntry['type'] = kind === 0o040000
            ? 'directory'
            : kind === 0o100000
              ? 'file'
              : kind === 0o120000
                ? 'symlink'
                : 'other'
          return {
            name: entry.filename,
            path: posix.join(normalizedPath, entry.filename),
            type,
            size: entry.attrs.size ?? 0,
            modifiedAt: entry.attrs.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : null,
            permissions: (mode & 0o777).toString(8).padStart(3, '0'),
          }
        })
        .sort((left, right) => {
          if (left.type === 'directory' && right.type !== 'directory') return -1
          if (left.type !== 'directory' && right.type === 'directory') return 1
          return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' })
        })
      resolve(result)
    })
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1160,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: '#f3f6f3',
    title: 'Ubuntu Server Files',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function registerIpc(): void {
  ipcMain.handle('profiles:list', () => readState().profiles)
  ipcMain.handle('profiles:save', async (_event, input: SaveProfileInput) => {
    const { profile, password } = input
    if (
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
    if (password && !safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 凭据加密不可用，不能安全保存密码')
    }

    const state = readState()
    const id = profile.id || randomUUID()
    const savedProfile = { ...profile, id, name: profile.name.trim(), host: profile.host.trim(), username: profile.username.trim() }
    const existingIndex = state.profiles.findIndex((candidate) => candidate.id === id)
    if (!password && !state.passwords[id]) throw new Error('请填写 SSH 密码')
    if (existingIndex === -1) state.profiles.push(savedProfile)
    else state.profiles[existingIndex] = savedProfile
    if (password) state.passwords[id] = safeStorage.encryptString(password).toString('base64')
    writeState(state)
    if (sessions.has(id)) stopSession(id)
    return savedProfile
  })

  ipcMain.handle('profiles:delete', (_event, profileId: string) => {
    stopSession(profileId)
    const state = readState()
    state.profiles = state.profiles.filter((profile) => profile.id !== profileId)
    delete state.passwords[profileId]
    writeState(state)
  })

  ipcMain.handle('connection:connect', (_event, profileId: string) => connectProfile(profileId))
  ipcMain.handle('connection:disconnect', (_event, profileId: string) => stopSession(profileId))
  ipcMain.handle('host-key:trust', (_event, input: TrustHostKeyInput) => {
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

  ipcMain.handle('files:list', (_event, profileId: string, remotePath: string) =>
    listDirectory(profileId, remotePath))

  ipcMain.handle('files:download', async (event, requestId: string, profileId: string, remotePath: string) => {
    const session = sessions.get(profileId)
    if (!session) throw new Error('服务器未连接')
    const normalizedPath = posix.resolve('/', remotePath)
    const attributes = await new Promise<{ mode?: number }>((resolve, reject) => {
      session.sftp.stat(normalizedPath, (error, attrs) => error ? reject(error) : resolve(attrs))
    })
    if (((attributes.mode ?? 0) & 0o170000) === 0o040000) throw new Error('暂不支持下载文件夹')

    const destination = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: '下载文件',
      defaultPath: basename(normalizedPath),
    })
    if (destination.canceled || !destination.filePath) return false

    const temporaryPath = `${destination.filePath}.${randomUUID()}.download`
    try {
      await new Promise<void>((resolve, reject) => {
        session.sftp.fastGet(normalizedPath, temporaryPath, {
          step: (transferred, _chunk, total) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send('files:download-progress', {
                requestId,
                profileId,
                remotePath: normalizedPath,
                transferred,
                total,
              })
            }
          },
        }, (error) => error ? reject(error) : resolve())
      })
      await rename(temporaryPath, destination.filePath)
      return true
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined)
      throw new Error(error instanceof Error ? error.message : '下载失败')
    }
  })
}

app.whenReady().then(async () => {
  stateFile = join(app.getPath('userData'), 'servers.json')
  await mkdir(app.getPath('userData'), { recursive: true })
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  for (const profileId of sessions.keys()) stopSession(profileId)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
