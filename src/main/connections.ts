import { type MessageValue, messageFromUnknown, msg, LocalizedError } from '../shared/i18n/messages'
import { clipboard } from 'electron'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { Client } from 'ssh2'
import type { ConnectResult, RemoteEntry, SessionKind } from '@shared/types'
import { shellQuoteIfNeeded } from '@shared/shell'
import { cancelNameSearchesForSession, failNameSearchesForSession } from './name-search'
import { cancelContentSearchesForSession, failContentSearchesForSession } from './content-search'
import { cancelScriptExecutionsForSession, failScriptExecutionsForSession } from './script-execution-runtime'
import { cancelTransfersForSession } from './transfers'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { endpointKey, passwordFor, profileFromState, readState } from './state-store'
import { clearPreviewAssetsForSession } from './previews'
import { cancelRemoteOperationsForSession } from './remote-operations'
import { removePerformanceMonitorForSession } from './performance-monitor'
import { cancelClientTasks, runRemoteCommand } from './ssh-commands'
import { filesSession, listRemoteDirectory } from './remote-fs'
import { verifyFileSessionCapabilities } from './file-session-capabilities'
import { initializeFileIdentity, revokeFileIdentity } from './file-identity'

const pendingConnections = new Map<string, { profileId: string; client: Client; cancel: () => void }>()
const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 3

function sendConnectionClosed(sessionId: string, profileId: string, message: MessageValue): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('connection:closed', { sessionId, profileId, message })
  }
}

function failActiveSession(activeSession: ActiveSession, message: MessageValue): void {
  if (sessions.get(activeSession.sessionId) !== activeSession) return
  sessions.delete(activeSession.sessionId)
  void revokeFileIdentity(activeSession)
  removePerformanceMonitorForSession(activeSession.sessionId)
  void cancelRemoteOperationsForSession(activeSession.sessionId)
  failScriptExecutionsForSession(activeSession.sessionId, message)
  failNameSearchesForSession(activeSession.sessionId, message)
  failContentSearchesForSession(activeSession.sessionId, message)
  cancelTransfersForSession(activeSession.sessionId)
  clearPreviewAssetsForSession(activeSession.sessionId)
  void cancelClientTasks(activeSession.client)
  sendConnectionClosed(activeSession.sessionId, activeSession.profileId, message)
}

export function stopSession(sessionId: string): Promise<void> {
  removePerformanceMonitorForSession(sessionId)
  pendingConnections.get(sessionId)?.cancel()
  cancelNameSearchesForSession(sessionId)
  cancelContentSearchesForSession(sessionId)
  cancelScriptExecutionsForSession(sessionId)
  const remoteOperations = cancelRemoteOperationsForSession(sessionId)
  const transfers = cancelTransfersForSession(sessionId)
  clearPreviewAssetsForSession(sessionId)
  const activeSession = sessions.get(sessionId)
  if (!activeSession) return Promise.resolve()
  const commands = cancelClientTasks(activeSession.client)
  const fileCommands = revokeFileIdentity(activeSession)
  sessions.delete(sessionId)
  return Promise.all([commands, fileCommands, remoteOperations, ...transfers.map((transfer) => transfer.settled)])
    .then(() => { activeSession.client.end() })
}

export function stopSessionsForProfile(profileId: string): void {
  for (const [sessionId, pending] of pendingConnections) {
    if (pending.profileId !== profileId) continue
    stopSession(sessionId)
    sendConnectionClosed(sessionId, profileId, msg('errors.serverConfigurationUpdated'))
  }
  for (const activeSession of sessions.values()) {
    if (activeSession.profileId !== profileId) continue
    stopSession(activeSession.sessionId)
    sendConnectionClosed(activeSession.sessionId, profileId, msg('errors.serverConfigurationUpdated'))
  }
}

export async function stopAllSessions(): Promise<void> {
  const ids = new Set([...pendingConnections.keys(), ...sessions.keys()])
  await Promise.all([...ids].map(stopSession))
}

export function connectProfile(
  sessionId: string,
  profileId: string,
  kind: SessionKind,
  cols: number,
  rows: number,
  startPath: string,
): Promise<ConnectResult> {
  if (pendingConnections.has(sessionId) || sessions.has(sessionId)) throw new LocalizedError(msg('errors.sessionIdIsAlreadyInUse'))
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve) => {
    const client = new Client()
    let settled = false
    let keyIssue: ConnectResult | null = null
    const isCurrentAttempt = () => pendingConnections.get(sessionId)?.client === client

    const finish = (result: ConnectResult) => {
      if (settled) return
      settled = true
      if (pendingConnections.get(sessionId)?.client === client) pendingConnections.delete(sessionId)
      if (!result.ok) client.end()
      resolve(result)
    }

    pendingConnections.set(sessionId, {
      profileId,
      client,
      cancel: () => finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') }),
    })

    client.on('ready', () => {
      if (!isCurrentAttempt()) {
        finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') })
        return
      }
      const activate = (shell?: ActiveSession['shell'], effectiveUid?: number) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') })
          return
        }
        const activeSession: ActiveSession = { sessionId, client, kind, profileId, shell }
        const fileIdentity = effectiveUid === undefined ? undefined : initializeFileIdentity(activeSession, effectiveUid)
        sessions.set(sessionId, activeSession)
        if (shell) {
          const stdoutDecoder = new StringDecoder('utf8')
          const stderrDecoder = new StringDecoder('utf8')
          const sendOutput = (data: string) => {
            if (!data) return
            const window = getMainWindow()
            if (window && !window.isDestroyed()) {
              window.webContents.send('terminal:output', { sessionId, data })
            }
          }
          shell.on('data', (chunk: Buffer) => sendOutput(stdoutDecoder.write(chunk)))
          shell.stderr.on('data', (chunk: Buffer) => sendOutput(stderrDecoder.write(chunk)))
          shell.on('close', () => {
            sendOutput(stdoutDecoder.end())
            sendOutput(stderrDecoder.end())
            if (sessions.get(sessionId) === activeSession) {
              failActiveSession(activeSession, msg('errors.sshTerminalExited'))
              client.end()
            }
          })
          shell.on('error', (shellError: Error) => failActiveSession(activeSession, shellError.message))
          if (startPath) shell.write('cd ' + shellQuoteIfNeeded(posix.resolve('/', startPath)) + '\n')
        }
        finish({ ok: true, path: kind === 'files' ? '/' : startPath, fileIdentity })
      }

      if (kind === 'files') {
        void verifyFileSessionCapabilities(client).then(() => runRemoteCommand(client, 'printf "%s" "$EUID"')).then(
          ({ stdout }) => {
            const uid = stdout.toString('ascii')
            if (!/^\d+$/.test(uid)) {
              finish({ ok: false, reason: 'other', message: msg('errors.serverReturnedAnInvalidLoginUid') })
              return
            }
            activate(undefined, Number(uid))
          },
          (error: unknown) => finish({ ok: false, reason: 'other', message: messageFromUnknown(error) }),
        )
      } else {
        client.shell({ term: 'xterm-256color', cols, rows }, (error, shell) => {
          if (error) {
            finish({ ok: false, reason: 'other', message: messageFromUnknown(error) })
            return
          }
          activate(shell)
        })
      }
    })

    client.on('error', (error: Error & { level?: string }) => {
      const activeSession = sessions.get(sessionId)
      if (activeSession?.client === client) {
        failActiveSession(
          activeSession,
          error.message === 'Keepalive timeout'
            ? msg('errors.sshKeepaliveTimedOutTheServerOrNetworkDisconnected')
            : error.message || msg('errors.sshConnectionError'),
        )
        client.destroy()
        return
      }
      if (!isCurrentAttempt() || settled) return
      if (keyIssue) {
        finish(keyIssue)
        return
      }
      const message = error.message || ''
      const lowerMessage = message.toLowerCase()
      if (error.level === 'client-authentication' || lowerMessage.includes('authentication')) {
        finish({ ok: false, reason: 'auth-failed', message: msg('errors.incorrectUsernameOrPasswordOrTheServerRejectedPasswordAuthentication') })
      } else if (/timed out|econnrefused|ehostunreach|enetunreach|enotfound|socket hang up/i.test(message)) {
        finish({ ok: false, reason: 'unreachable', message: msg('errors.cannotConnectToTheServerCheckTheAddressPortNetwork') })
      } else {
        finish({ ok: false, reason: 'other', message: message || msg('errors.connectionFailed') })
      }
    })

    client.on('close', () => {
      const activeSession = sessions.get(sessionId)
      if (activeSession?.client === client) failActiveSession(activeSession, msg('errors.sshConnectionClosed'))
      if (!settled && isCurrentAttempt()) {
        finish({ ok: false, reason: 'unreachable', message: msg('errors.connectionClosedBeforeItWasEstablished') })
      }
    })

    client.connect({
      host: profile.host,
      port: profile.port,
      username: profile.username,
      password,
      readyTimeout: 15000,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      hostVerifier: (hash: Buffer, callback: (verified: boolean) => void) => {
        if (!isCurrentAttempt()) {
          callback(false)
          return
        }
        const fingerprint = 'SHA256:' + createHash('sha256').update(hash).digest('base64').replace(/=+$/, '')
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

export function writeTerminal(sessionId: string, data: string): void {
  const shell = sessions.get(sessionId)?.shell
  if (!shell || shell.destroyed) throw new LocalizedError(msg('errors.sshTerminalIsNotConnected'))
  shell.write(data)
}

export function resizeTerminal(sessionId: string, cols: number, rows: number): void {
  const shell = sessions.get(sessionId)?.shell
  if (!shell || shell.destroyed) throw new LocalizedError(msg('errors.sshTerminalIsNotConnected'))
  shell.setWindow(rows, cols, 0, 0)
}

export function listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]> {
  return listRemoteDirectory(filesSession(sessionId).commands, remotePath)
}

export function copyRemotePath(sessionId: string, remotePath: string): void {
  filesSession(sessionId)
  clipboard.writeText(posix.resolve('/', remotePath))
}

export async function createRemoteDirectory(
  sessionId: string,
  remoteDirectory: string,
  name: string,
): Promise<void> {
  const { commands } = filesSession(sessionId)
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new LocalizedError(msg('errors.invalidNamePathSeparatorsAndAreNotAllowed'))
  }
  const parentPath = posix.resolve('/', remoteDirectory)
  const targetPath = posix.join(parentPath, name)
  await runRemoteCommand(commands, 'mkdir -- "$1"', [targetPath])
}

export async function deleteRemoteEntries(sessionId: string, remotePaths: string[]): Promise<void> {
  const { commands } = filesSession(sessionId)
  if (!Array.isArray(remotePaths) || remotePaths.length === 0) throw new LocalizedError(msg('errors.selectAtLeastOneRemoteItem'))
  const paths = remotePaths.map((remotePath) => {
    if (typeof remotePath !== 'string' || !remotePath || remotePath.includes('\0')) throw new LocalizedError(msg('errors.invalidDeletionPath'))
    return posix.resolve('/', remotePath)
  })
  if (paths.includes('/')) throw new LocalizedError(msg('errors.cannotDeleteTheServerRootDirectory'))
  if (new Set(paths).size !== paths.length) throw new LocalizedError(msg('errors.deletionListContainsDuplicatePaths'))
  await runRemoteCommand(commands,
    'set -eu; for path in "$@"; do [[ ! -L "$path" && ( -f "$path" || -d "$path" ) ]] || { printf "LINUX_NEXUS_DIAGNOSTIC:deleteType: %s\\n" "$path" >&2; exit 1; }; done; rm -r -- "$@"',
    paths,
  )
}

