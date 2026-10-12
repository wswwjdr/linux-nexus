import { app, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import { safeStorage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { lstat as localLstat, mkdir, readdir as localReaddir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'
import { Client, type SFTPWrapper } from 'ssh2'
import type {
  ConnectResult,
  PreviewLimits,
  PreviewResult,
  RemoteEntry,
  SaveProfileInput,
  ServerProfile,
  TransferProgress,
  TrustHostKeyInput,
} from '@shared/types'

protocol.registerSchemesAsPrivileged([{
  scheme: 'remote-preview',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}])

interface StoredState {
  profiles: ServerProfile[]
  passwords: Record<string, string>
  hostKeys: Record<string, string>
}

const DEFAULT_PREVIEW_LIMITS: PreviewLimits = {
  textMiB: 5,
  imageMiB: 100,
  audioMiB: 100,
  videoMiB: 100,
}

const MAX_PREVIEW_LIMIT_MIB = 1024

interface ActiveSession {
  client: Client
  sftp: SFTPWrapper
  profileId: string
}

interface TransferItem {
  relativePath: string
  type: 'directory' | 'file'
  size: number
  localPath?: string
  remotePath?: string
}

interface SftpAttributes {
  mode?: number
  size?: number
  mtime?: number
}

interface SftpDirectoryEntry {
  filename: string
  attrs: SftpAttributes
}

const sessions = new Map<string, ActiveSession>()
const previewAssets = new Map<string, string>()
const activeTransfers = new Set<string>()
let mainWindow: BrowserWindow | null = null
let stateFile = ''
let settingsFile = ''
let pendingConnection: { profileId: string; client: Client; generation: number; cancel: () => void } | null = null
let connectionGeneration = 0
let focusWindowWhenCreated = false

function focusMainWindow(): void {
  if (!mainWindow) {
    focusWindowWhenCreated = true
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', focusMainWindow)
}

function fileType(mode?: number): 'directory' | 'file' | 'symlink' | 'other' {
  const kind = (mode ?? 0) & 0o170000
  if (kind === 0o040000) return 'directory'
  if (kind === 0o100000) return 'file'
  if (kind === 0o120000) return 'symlink'
  return 'other'
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sftpLstat(sftp: SFTPWrapper, remotePath: string): Promise<SftpAttributes> {
  return new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error, attrs) => error ? reject(error) : resolve(attrs))
  })
}

function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<SftpDirectoryEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (error, entries) => error ? reject(error) : resolve(entries))
  })
}

function isRemoteNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string | number }).code
  return code === 2 || code === 'ENOENT' || /no such file|not found/i.test(error.message)
}

async function remoteAttributesOrNull(sftp: SFTPWrapper, remotePath: string): Promise<SftpAttributes | null> {
  try {
    return await sftpLstat(sftp, remotePath)
  } catch (error) {
    if (isRemoteNotFound(error)) return null
    throw error
  }
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (error) => error ? reject(error) : resolve())
  })
}

function sftpRename(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (error) => error ? reject(error) : resolve())
  })
}

function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (error) => error ? reject(error) : resolve())
  })
}

function transferFile(
  operation: 'get' | 'put',
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationPath: string,
  onProgress: (transferred: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = { step: (transferred: number, _chunk: number, total: number) => onProgress(transferred, total) }
    const callback = (error?: Error) => error ? reject(error) : resolve()
    if (operation === 'get') sftp.fastGet(sourcePath, destinationPath, options, callback)
    else sftp.fastPut(sourcePath, destinationPath, options, callback)
  })
}

async function collectRemoteTree(sftp: SFTPWrapper, remoteRoot: string): Promise<TransferItem[]> {
  const items: TransferItem[] = []

  const visit = async (remotePath: string, relativePath: string, attrs: SftpAttributes) => {
    const type = fileType(attrs.mode)
    if (type === 'symlink') throw new Error(`目录包含符号链接，无法传输：${remotePath}`)
    if (type === 'other') throw new Error(`目录包含暂不支持的文件类型：${remotePath}`)
    items.push({ relativePath, type, size: attrs.size ?? 0, remotePath })
    if (type !== 'directory') return

    const entries = await sftpReaddir(sftp, remotePath)
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue
      const childPath = posix.join(remotePath, entry.filename)
      const childRelativePath = relativePath ? posix.join(relativePath, entry.filename) : entry.filename
      await visit(childPath, childRelativePath, entry.attrs)
    }
  }

  await visit(remoteRoot, '', await sftpLstat(sftp, remoteRoot))
  return items
}

async function collectLocalTree(localRoot: string): Promise<TransferItem[]> {
  const items: TransferItem[] = []

  const visit = async (localPath: string, relativePath: string) => {
    const attrs = await localLstat(localPath)
    if (attrs.isSymbolicLink()) throw new Error(`目录包含符号链接，无法传输：${localPath}`)
    if (attrs.isDirectory()) {
      items.push({ relativePath, type: 'directory', size: 0, localPath })
      const entries = await localReaddir(localPath, { withFileTypes: true })
      for (const entry of entries) {
        const childPath = join(localPath, entry.name)
        const childRelativePath = relativePath ? posix.join(relativePath, entry.name) : entry.name
        await visit(childPath, childRelativePath)
      }
      return
    }
    if (!attrs.isFile()) throw new Error(`目录包含暂不支持的文件类型：${localPath}`)
    items.push({ relativePath, type: 'file', size: attrs.size, localPath })
  }

  await visit(localRoot, '')
  return items
}

function assertWindowsPath(relativePath: string): void {
  for (const name of relativePath.split(/[\/\\]/)) {
    if (!name) continue
    if (/[<>:"\/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(name)) {
      throw new Error(`Windows 不支持此文件名，无法下载：${name}`)
    }
  }
}

async function confirmOverwrite(collisions: string[], operation: string): Promise<boolean> {
  if (!collisions.length) return true
  const result = await dialog.showMessageBox(mainWindow ?? undefined, {
    type: 'warning',
    title: '确认覆盖文件',
    message: `本次${operation}发现 ${collisions.length} 个同名文件。`,
    detail: '继续后会覆盖这些文件；同名文件夹会合并。',
    buttons: ['取消传输', '覆盖并继续'],
    defaultId: 0,
    cancelId: 0,
  })
  return result.response === 1
}

async function withTransferLock<T>(profileId: string, operation: () => Promise<T>): Promise<T> {
  if (activeTransfers.has(profileId)) throw new Error('此服务器已有文件传输正在进行')
  activeTransfers.add(profileId)
  try {
    return await operation()
  } finally {
    activeTransfers.delete(profileId)
  }
}

function sendTransferProgress(
  sender: Electron.WebContents,
  requestId: string,
  profileId: string,
  remotePath: string,
  direction: TransferProgress['direction'],
  transferred: number,
  total: number,
): void {
  if (sender.isDestroyed()) return
  sender.send('files:transfer-progress', { requestId, profileId, remotePath, direction, transferred, total } satisfies TransferProgress)
}

async function prepareLocalDestination(items: TransferItem[], destinationRoot: string): Promise<string[]> {
  const collisions: string[] = []
  const pathKeys = new Set<string>()
  for (const item of items) {
    assertWindowsPath(item.relativePath)
    const pathKey = item.relativePath.replace(/\\/g, '/').toLowerCase()
    if (pathKeys.has(pathKey)) throw new Error(`服务器中存在 Windows 无法区分的同名路径：${item.relativePath}`)
    pathKeys.add(pathKey)
    const destination = localDestination(destinationRoot, item.relativePath)
    let attrs: Awaited<ReturnType<typeof localLstat>>
    try {
      attrs = await localLstat(destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    if (attrs.isSymbolicLink()) throw new Error(`目标位置包含符号链接，无法传输：${destination}`)
    if (item.type === 'directory' && !attrs.isDirectory()) {
      throw new Error(`目标文件与待下载文件夹重名：${destination}`)
    }
    if (item.type === 'file' && !attrs.isFile()) {
      throw new Error(`目标文件夹与待下载文件重名：${destination}`)
    }
    if (item.type === 'file') collisions.push(destination)
  }
  return collisions
}

function localDestination(destinationRoot: string, relativePath: string): string {
  const root = resolve(destinationRoot)
  const destination = relativePath ? resolve(root, ...relativePath.split(/[\\/]/)) : root
  const fromRoot = relative(root, destination)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`下载路径无效：${relativePath}`)
  }
  return destination
}

async function prepareRemoteDestination(
  sftp: SFTPWrapper,
  items: TransferItem[],
  remoteRoot: string,
): Promise<{ collisions: string[]; existingDirectories: Set<string> }> {
  const collisions: string[] = []
  const existingDirectories = new Set<string>()
  const targetPaths = new Set<string>()
  for (const item of items) {
    const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
    if (targetPaths.has(destination)) throw new Error(`本次选择包含重名文件：${destination}`)
    targetPaths.add(destination)
    const attrs = await remoteAttributesOrNull(sftp, destination)
    if (!attrs) continue
    const type = fileType(attrs.mode)
    if (type === 'symlink') throw new Error(`目标位置包含符号链接，无法传输：${destination}`)
    if (item.type === 'directory' && type !== 'directory') {
      throw new Error(`目标文件与待上传文件夹重名：${destination}`)
    }
    if (item.type === 'file' && type !== 'file') {
      throw new Error(`目标文件夹与待上传文件重名：${destination}`)
    }
    if (item.type === 'directory') existingDirectories.add(destination)
    else collisions.push(destination)
  }
  return { collisions, existingDirectories }
}

async function uploadSelection(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  profileId: string,
  remoteDirectory: string,
  uploadFolder: boolean,
): Promise<boolean> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const selection = await dialog.showOpenDialog(mainWindow ?? undefined, uploadFolder
    ? { title: '选择要上传的文件夹', properties: ['openDirectory'] }
    : { title: '选择要上传的文件', properties: ['openFile', 'multiSelections'] })
  if (selection.canceled || selection.filePaths.length === 0) return false

  const normalizedDirectory = posix.resolve('/', remoteDirectory || '/')
  const directoryAttributes = await sftpLstat(session.sftp, normalizedDirectory)
  if (fileType(directoryAttributes.mode) !== 'directory') throw new Error('上传目标不是文件夹')

  let remoteRoot = normalizedDirectory
  let items: TransferItem[]
  if (uploadFolder) {
    const localRoot = selection.filePaths[0]
    items = await collectLocalTree(localRoot)
    remoteRoot = posix.join(normalizedDirectory, basename(localRoot))
  } else {
    items = []
    for (const localPath of selection.filePaths) {
      const attrs = await localLstat(localPath)
      if (attrs.isSymbolicLink()) throw new Error(`不能上传符号链接：${localPath}`)
      if (!attrs.isFile()) throw new Error(`只能上传普通文件：${localPath}`)
      items.push({ relativePath: basename(localPath), type: 'file', size: attrs.size, localPath })
    }
  }

  const { collisions, existingDirectories } = await prepareRemoteDestination(session.sftp, items, remoteRoot)
  if (!await confirmOverwrite(collisions, '上传')) return false

  const collisionSet = new Set(collisions)
  const total = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)
  let completed = 0

  for (const item of items) {
    const destination = item.relativePath ? posix.join(remoteRoot, item.relativePath) : remoteRoot
    if (item.type === 'directory') {
      if (!existingDirectories.has(destination)) await sftpMkdir(session.sftp, destination)
      continue
    }

    const temporaryPath = posix.join(posix.dirname(destination), `.${posix.basename(destination)}.${randomUUID()}.upload`)
    let committed = false
    try {
      await transferFile('put', session.sftp, item.localPath!, temporaryPath, (transferred) => {
        sendTransferProgress(event.sender, requestId, profileId, destination, 'upload', completed + transferred, total)
      })
      const backupPath = collisionSet.has(destination)
        ? posix.join(posix.dirname(destination), `.${posix.basename(destination)}.${randomUUID()}.backup`)
        : null
      if (backupPath) await sftpRename(session.sftp, destination, backupPath)
      try {
        await sftpRename(session.sftp, temporaryPath, destination)
      } catch (error) {
        if (backupPath) {
          try {
            await sftpRename(session.sftp, backupPath, destination)
          } catch (restoreError) {
            throw new Error(`${messageFromError(error)}；旧文件恢复失败，备份保留在 ${backupPath}：${messageFromError(restoreError)}`)
          }
        }
        throw error
      }
      committed = true
      if (backupPath) {
        try {
          await sftpUnlink(session.sftp, backupPath)
        } catch (error) {
          throw new Error(`上传已完成，但无法清理旧文件备份 ${backupPath}：${messageFromError(error)}`)
        }
      }
    } finally {
      if (!committed) await sftpUnlink(session.sftp, temporaryPath).catch(() => undefined)
    }
    completed += item.size
    sendTransferProgress(event.sender, requestId, profileId, destination, 'upload', completed, total)
  }
  return true
}

async function downloadRemoteItems(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  profileId: string,
  items: TransferItem[],
  destinationRoot: string,
): Promise<void> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const total = items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0)
  let completed = 0

  for (const item of items) {
    const destination = localDestination(destinationRoot, item.relativePath)
    if (item.type === 'directory') {
      await mkdir(destination, { recursive: true })
      continue
    }

    await mkdir(dirname(destination), { recursive: true })
    const temporaryPath = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.download`)
    let committed = false
    try {
      await transferFile('get', session.sftp, item.remotePath!, temporaryPath, (transferred) => {
        sendTransferProgress(event.sender, requestId, profileId, item.remotePath!, 'download', completed + transferred, total)
      })
      await rename(temporaryPath, destination)
      committed = true
    } finally {
      if (!committed) await unlink(temporaryPath).catch(() => undefined)
    }
    completed += item.size
    sendTransferProgress(event.sender, requestId, profileId, item.remotePath!, 'download', completed, total)
  }
}

async function downloadEntry(
  event: Electron.IpcMainInvokeEvent,
  requestId: string,
  profileId: string,
  remotePath: string,
): Promise<boolean> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const attributes = await sftpLstat(session.sftp, normalizedPath)
  const type = fileType(attributes.mode)
  if (type === 'symlink') throw new Error(`不能下载符号链接：${normalizedPath}`)

  if (type === 'file') {
    const destination = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择文件下载位置',
      properties: ['openDirectory'],
    })
    if (destination.canceled || !destination.filePaths[0]) return false
    const fileName = posix.basename(normalizedPath)
    assertWindowsPath(fileName)
    const localPath = join(destination.filePaths[0], fileName)
    const item: TransferItem = { relativePath: '', type: 'file', size: attributes.size ?? 0, remotePath: normalizedPath }
    const collisions = await prepareLocalDestination([item], localPath)
    if (!await confirmOverwrite(collisions, '下载')) return false
    await downloadRemoteItems(event, requestId, profileId, [item], localPath)
    return true
  }

  if (type !== 'directory') throw new Error('只能下载普通文件或文件夹')
  if (normalizedPath === '/') throw new Error('暂不支持下载服务器根目录')
  const destination = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: '选择文件夹下载位置',
    properties: ['openDirectory'],
  })
  if (destination.canceled || !destination.filePaths[0]) return false

  const folderName = posix.basename(normalizedPath)
  assertWindowsPath(folderName)
  const localRoot = join(destination.filePaths[0], folderName)
  const items = await collectRemoteTree(session.sftp, normalizedPath)
  const collisions = await prepareLocalDestination(items, localRoot)
  if (!await confirmOverwrite(collisions, '下载')) return false
  await downloadRemoteItems(event, requestId, profileId, items, localRoot)
  return true
}

function previewType(remotePath: string): PreviewResult['type'] | null {
  const extension = extname(remotePath).toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.gif'].includes(extension)) return 'image'
  if (['.txt', '.sh'].includes(extension)) return 'text'
  if (extension === '.mp3') return 'audio'
  if (extension === '.mp4') return 'video'
  return null
}

async function previewFile(profileId: string, remotePath: string): Promise<PreviewResult> {
  const session = sessions.get(profileId)
  if (!session) throw new Error('服务器未连接')
  const normalizedPath = posix.resolve('/', remotePath)
  const type = previewType(normalizedPath)
  if (!type) throw new Error('暂不支持的文件类型')
  const attrs = await sftpLstat(session.sftp, normalizedPath)
  if (fileType(attrs.mode) !== 'file') throw new Error('只能预览普通文件')
  const name = posix.basename(normalizedPath)
  const limits = readPreviewLimits()
  const limitMiB = limits[`${type}MiB`]
  const limitBytes = limitMiB * 1024 * 1024
  if ((attrs.size ?? 0) > limitBytes) throw previewSizeError(limitMiB)

  if (type === 'text') {
    const stream = session.sftp.createReadStream(normalizedPath)
    const chunks: Buffer[] = []
    let received = 0
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.from(chunk)
        received += buffer.length
        if (received > limitBytes) throw previewSizeError(limitMiB)
        chunks.push(buffer)
      }
    } finally {
      if (!stream.destroyed) stream.destroy()
    }
    const content = Buffer.concat(chunks).toString('utf8')
    return { type, name, content }
  }

  const token = randomUUID()
  const extension = extname(normalizedPath).toLowerCase()
  const directory = join(app.getPath('temp'), 'ubuntu-server-files-preview')
  const filePath = join(directory, `${token}${extension}`)
  await mkdir(directory, { recursive: true })
  try {
    let received = 0
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length
        if (received > limitBytes) callback(previewSizeError(limitMiB))
        else callback(null, chunk)
      },
    })
    await pipeline(
      session.sftp.createReadStream(normalizedPath),
      limiter,
      createWriteStream(filePath, { flags: 'wx' }),
    )
  } catch (error) {
    await unlink(filePath).catch(() => undefined)
    throw error
  }
  previewAssets.set(token, filePath)
  return { type, name, url: `remote-preview://${token}/${encodeURIComponent(name)}`, token }
}

function previewSizeError(limitMiB: number): Error {
  return new Error(`文件超过预览上限（${limitMiB} MiB），请下载后查看`)
}

async function releasePreview(token: string): Promise<void> {
  const filePath = previewAssets.get(token)
  if (!filePath) return
  previewAssets.delete(token)
  await unlink(filePath).catch(() => undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function validatePreviewLimits(value: unknown): PreviewLimits {
  const keys = Object.keys(DEFAULT_PREVIEW_LIMITS)
  if (!isRecord(value) || !hasExactKeys(value, keys)) {
    throw new Error('预览设置结构无效')
  }
  for (const key of keys) {
    const limit = value[key]
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_PREVIEW_LIMIT_MIB) {
      throw new Error(`预览设置 ${key} 必须是 1 到 ${MAX_PREVIEW_LIMIT_MIB} 之间的整数`)
    }
  }
  return value as unknown as PreviewLimits
}

function validateStoredState(value: unknown, verifyPasswordCiphertexts = false): StoredState {
  const keys = ['profiles', 'passwords', 'hostKeys']
  if (!isRecord(value) || !hasExactKeys(value, keys) || !Array.isArray(value.profiles)
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
        throw new Error(`服务器密码密文无效：${profileId}`)
      }
    }
  }
  for (const [endpoint, fingerprint] of Object.entries(value.hostKeys)) {
    if (!endpoint || typeof fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(fingerprint)) {
      throw new Error('服务器指纹数据结构无效')
    }
  }

  return value as unknown as StoredState
}

function parseJsonFile(filePath: string): unknown {
  let contents: string
  try {
    contents = readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new Error(`无法读取配置文件 ${filePath}：${messageFromError(error)}`)
  }
  try {
    return JSON.parse(contents) as unknown
  } catch (error) {
    throw new Error(`配置文件格式无效 ${filePath}：${messageFromError(error)}`)
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`
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
    throw new Error(`无法安全保存配置文件 ${filePath}：${messageFromError(error)}`)
  }
}

function readState(verifyPasswordCiphertexts = false): StoredState {
  if (!existsSync(stateFile)) return { profiles: [], passwords: {}, hostKeys: {} }
  try {
    return validateStoredState(parseJsonFile(stateFile), verifyPasswordCiphertexts)
  } catch (error) {
    throw new Error(`服务器配置无效（${stateFile}）：${messageFromError(error)}`)
  }
}

function writeState(state: StoredState): void {
  atomicWriteJson(stateFile, state)
}

function readPreviewLimits(): PreviewLimits {
  if (!existsSync(settingsFile)) {
    atomicWriteJson(settingsFile, DEFAULT_PREVIEW_LIMITS)
    return { ...DEFAULT_PREVIEW_LIMITS }
  }
  try {
    return validatePreviewLimits(parseJsonFile(settingsFile))
  } catch (error) {
    throw new Error(`预览设置无效（${settingsFile}）：${messageFromError(error)}`)
  }
}

function writePreviewLimits(limits: unknown): PreviewLimits {
  const validated = validatePreviewLimits(limits)
  atomicWriteJson(settingsFile, validated)
  return validated
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
  if (pendingConnection?.profileId === profileId) pendingConnection.cancel()
  const session = sessions.get(profileId)
  if (!session) return
  sessions.delete(profileId)
  session.client.end()
}

function stopAllSessions(): void {
  pendingConnection?.cancel()
  for (const profileId of sessions.keys()) stopSession(profileId)
}

function connectProfile(profileId: string): Promise<ConnectResult> {
  stopAllSessions()
  const generation = ++connectionGeneration
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    let keyIssue: ConnectResult | null = null
    const isCurrentAttempt = () => connectionGeneration === generation
      && pendingConnection?.client === client
      && pendingConnection.generation === generation

    const finish = (result: ConnectResult) => {
      if (settled) return
      settled = true
      if (pendingConnection?.client === client) pendingConnection = null
      if (!result.ok) client.end()
      resolve(result)
    }

    pendingConnection = {
      profileId,
      client,
      generation,
      cancel: () => finish({ ok: false, reason: 'other', message: '连接已取消' }),
    }

    client.on('ready', () => {
      if (!isCurrentAttempt()) {
        finish({ ok: false, reason: 'other', message: '连接已取消' })
        return
      }
      client.sftp((error, sftp) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: '连接已取消' })
          return
        }
        if (error) {
          finish({ ok: false, reason: 'sftp-unavailable', message: error.message })
          return
        }
        sessions.set(profileId, { client, sftp, profileId })
        finish({ ok: true, path: '/' })
      })
    })

    client.on('error', (error: Error & { level?: string }) => {
      if (sessions.get(profileId)?.client === client) {
        sessions.delete(profileId)
        sendConnectionClosed(profileId, error.message)
        return
      }
      if (!isCurrentAttempt() || settled) return
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
      if (!settled && isCurrentAttempt()) {
        finish({ ok: false, reason: 'unreachable', message: '连接在完成前关闭' })
      }
    })

    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password,
      readyTimeout: 15000,
      hostVerifier: (hash, callback) => {
        if (!isCurrentAttempt()) {
          callback(false)
          return
        }
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
  const window = new BrowserWindow({
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
  mainWindow = window

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  window.on('closed', () => {
    mainWindow = null
    previewAssets.clear()
    void rm(join(app.getPath('temp'), 'ubuntu-server-files-preview'), { recursive: true, force: true })
  })

  if (focusWindowWhenCreated) {
    focusWindowWhenCreated = false
    window.once('ready-to-show', () => {
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    })
  }
}

function registerPreviewProtocol(): void {
  session.defaultSession.protocol.handle('remote-preview', (request) => {
    const token = new URL(request.url).hostname
    const filePath = previewAssets.get(token)
    if (!filePath) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString(), { headers: request.headers })
  })
}

function registerIpc(): void {
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
    if (!password && !state.passwords[id]) throw new Error('请填写 SSH 密码')
    if (existingIndex === -1) state.profiles.push(savedProfile)
    else state.profiles[existingIndex] = savedProfile
    if (password) state.passwords[id] = safeStorage.encryptString(password).toString('base64')
    writeState(state)
    stopSession(id)
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
  ipcMain.handle('settings:preview-limits:get', () => readPreviewLimits())
  ipcMain.handle('settings:preview-limits:save', (_event, limits: PreviewLimits) => writePreviewLimits(limits))
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

  ipcMain.handle('files:list', (_event, profileId: string, remotePath: string) =>
    listDirectory(profileId, remotePath))
  ipcMain.handle('files:upload-files', (event, requestId: string, profileId: string, remoteDirectory: string) =>
    withTransferLock(profileId, () => uploadSelection(event, requestId, profileId, remoteDirectory, false)))
  ipcMain.handle('files:upload-folder', (event, requestId: string, profileId: string, remoteDirectory: string) =>
    withTransferLock(profileId, () => uploadSelection(event, requestId, profileId, remoteDirectory, true)))
  ipcMain.handle('files:download', (event, requestId: string, profileId: string, remotePath: string) =>
    withTransferLock(profileId, () => downloadEntry(event, requestId, profileId, remotePath)))
  ipcMain.handle('files:preview', (_event, profileId: string, remotePath: string) => previewFile(profileId, remotePath))
  ipcMain.handle('files:preview-release', (_event, token: string) => releasePreview(token))
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  stateFile = join(app.getPath('userData'), 'servers.json')
  settingsFile = join(app.getPath('userData'), 'settings.json')
  await mkdir(app.getPath('userData'), { recursive: true })
  try {
    readState(true)
    readPreviewLimits()
  } catch (error) {
    dialog.showErrorBox(
      '配置文件无效',
      `${messageFromError(error)}\n\n应用未修改配置文件。请修复该文件后重新启动。`,
    )
    app.exit(1)
    return
  }
  const previewDirectory = join(app.getPath('temp'), 'ubuntu-server-files-preview')
  await rm(previewDirectory, { recursive: true, force: true })
  await mkdir(previewDirectory, { recursive: true })
  registerPreviewProtocol()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  dialog.showErrorBox('启动失败', messageFromError(error))
  app.exit(1)
})

app.on('before-quit', () => {
  stopAllSessions()
  previewAssets.clear()
})

app.on('will-quit', () => {
  if (hasSingleInstanceLock) {
    rmSync(join(app.getPath('temp'), 'ubuntu-server-files-preview'), { recursive: true, force: true })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
