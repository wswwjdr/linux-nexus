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
import { archivePreparationKey, archivePreparationSeen, endpointKey, passwordFor, profileFromState, readState, saveArchivePreparation } from './state-store'
import { clearPreviewAssetsForSession } from './previews'
import { cancelRemoteOperationsForSession } from './remote-operations'
import { registerPerformanceConnection, unregisterPerformanceConnection } from './performance-monitor'
import { cancelClientTasks, runRemoteCommand } from './ssh-commands'
import { filesSession, listRemoteDirectory } from './remote-fs'
import { archiveSetupCapabilities, capabilitiesReady, checkCapabilities, inspectServer, type ServerEnvironment } from './server-capabilities'
import type { DependencyCheckResult } from '@shared/types'
import { createDependencyPlan } from './dependency-plans'
import { initializeFileIdentity, revokeFileIdentity, rootTerminalScope } from './file-identity'

const pendingConnections = new Map<string, { profileId: string; client: Client; cancel: () => void }>()
const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 3

function sendConnectionClosed(sessionId: string, profileId: string, message: MessageValue): void {
  const window = getMainWindow()
  if (window && !window.isDestroyed()) {
    window.webContents.send('connection:closed', { sessionId, profileId, message })
  }
}

/**
 * Releases a failed connection and reports the reason to its workspace tab.
 * @param activeSession Exact connection that failed.
 * @param message Reason shown to the user.
 */
function failActiveSession(activeSession: ActiveSession, message: MessageValue): void {
  if (sessions.get(activeSession.sessionId) !== activeSession) return
  sessions.delete(activeSession.sessionId)
  unregisterPerformanceConnection(activeSession)
  void revokeFileIdentity(activeSession)
  void cancelRemoteOperationsForSession(activeSession.sessionId)
  failScriptExecutionsForSession(activeSession.sessionId, message)
  failNameSearchesForSession(activeSession.sessionId, message)
  failContentSearchesForSession(activeSession.sessionId, message)
  cancelTransfersForSession(activeSession.sessionId)
  clearPreviewAssetsForSession(activeSession.sessionId)
  void cancelClientTasks(activeSession.client)
  sendConnectionClosed(activeSession.sessionId, activeSession.profileId, message)
}

/**
 * Stops a pending or live session and releases its connection resources.
 * @param sessionId Session to stop.
 * @returns A promise that resolves once the connection has been closed or was absent.
 */
export function stopSession(sessionId: string): Promise<void> {
  pendingConnections.get(sessionId)?.cancel()
  cancelNameSearchesForSession(sessionId)
  cancelContentSearchesForSession(sessionId)
  cancelScriptExecutionsForSession(sessionId)
  const remoteOperations = cancelRemoteOperationsForSession(sessionId)
  const transfers = cancelTransfersForSession(sessionId)
  clearPreviewAssetsForSession(sessionId)
  const activeSession = sessions.get(sessionId)
  if (!activeSession) return Promise.resolve()
  sessions.delete(sessionId)
  unregisterPerformanceConnection(activeSession)
  const commands = cancelClientTasks(activeSession.client)
  const fileCommands = revokeFileIdentity(activeSession)
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

/**
 * Connects profileId as a file or terminal session with the supplied id, terminal size,
 * initial path and optional root source, returning its connection result.
 */
export function connectProfile(
  sessionId: string,
  profileId: string,
  kind: SessionKind,
  cols: number,
  rows: number,
  startPath: string,
  rootSourceSessionId?: string,
): Promise<ConnectResult> {
  if (pendingConnections.has(sessionId) || sessions.has(sessionId)) throw new LocalizedError(msg('errors.sessionIdIsAlreadyInUse'))
  const rootScope = rootSourceSessionId === undefined ? undefined : rootTerminalScope(rootSourceSessionId, profileId)
  const state = readState()
  const profile = profileFromState(state, profileId)
  const password = passwordFor(state, profileId)

  return new Promise((resolve) => {
    const client = new Client()
    const connection = new AbortController()
    let settled = false
    let preparingEnvironment = false
    let keyIssue: Extract<ConnectResult, { reason: 'host-key-unknown' | 'host-key-changed' }> | null = null
    let hostFingerprint: string | undefined
    const isCurrentAttempt = () => pendingConnections.get(sessionId)?.client === client

    /** Completes the pending attempt and reports late connection failures after a proposal was shown. */
    const finish = (result: Exclude<ConnectResult, { reason: 'dependencies' }>, notify = true) => {
      if (settled) return
      settled = true
      if (pendingConnections.get(sessionId)?.client === client) pendingConnections.delete(sessionId)
      if (!result.ok) {
        connection.abort()
        client.end()
        if (notify && preparingEnvironment && 'message' in result) sendConnectionClosed(sessionId, profileId, result.message)
      }
      resolve(result)
    }

    pendingConnections.set(sessionId, {
      profileId,
      client,
      cancel: () => finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') }, false),
    })

    client.on('ready', () => {
      if (!isCurrentAttempt()) {
        finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') })
        return
      }
      /**
       * Registers the initialized session and completes the connection attempt.
       * @param shell Interactive channel for a terminal session.
       * @param environment Verified login environment for a file session.
       * @param initialOutput Buffered terminal output to display on activation.
       * @param archiveKey Key to record after the first successful directory listing.
       * @returns The initial file session identity, if applicable.
       */
      const activate = (shell?: ActiveSession['shell'], environment?: ServerEnvironment, initialOutput?: Buffer, archiveKey?: string) => {
        if (!isCurrentAttempt()) {
          finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') })
          return
        }
        const platform = environment && { endpoint: endpointKey(profile), environment, pendingArchivePreparation: archiveKey }
        const activeSession: ActiveSession = { sessionId, client, kind, profileId, username: profile.username, shell, hostFingerprint, platform }
        const fileIdentity = environment && initializeFileIdentity(activeSession, environment.effectiveUid)
        sessions.set(sessionId, activeSession)
        registerPerformanceConnection(activeSession)
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
          if (initialOutput) sendOutput(stdoutDecoder.write(initialOutput))
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
          if (startPath && !rootScope) shell.write('cd ' + shellQuoteIfNeeded(posix.resolve('/', startPath)) + '\n')
        }
        finish({ ok: true, path: kind === 'files' ? '/' : startPath, fileIdentity })
        return fileIdentity
      }

      if (kind === 'files') {
        /** Inspects this connection attempt using the supplied cancellation signal. */
        const inspect = async (signal: AbortSignal) => {
          const environment = await inspectServer(client, signal)
          return { environment, report: environment.base }
        }
        /** Checks optional archive tools for the first visit using the verified login environment. */
        const prepareArchives = async (environment: ServerEnvironment): Promise<DependencyCheckResult> => {
          if (!hostFingerprint) throw new Error('SSH host identity missing after verification')
          const key = archivePreparationKey(profile, hostFingerprint)
          if (archivePreparationSeen(profileId, key)) return { status: 'ready', fileIdentity: activate(undefined, environment) }

          /** Activates the session with the supplied environment and defers recording setup to the first listing. */
          const enter = (verified: ServerEnvironment) => ({
            status: 'ready' as const, fileIdentity: activate(undefined, verified, undefined, key),
          })
          const report = await checkCapabilities(client, archiveSetupCapabilities, connection.signal)
          connection.signal.throwIfAborted()
          if (capabilitiesReady(report)) return enter(environment)

          const issue = createDependencyPlan({
            sessionId, endpoint: endpointKey(profile), client, signal: connection.signal, purpose: 'archive-setup',
            inspect: async signal => ({ environment: await inspectServer(client, signal), report: await checkCapabilities(client, archiveSetupCapabilities, signal) }),
            onReady: enter, onSkip: enter,
            onDiscard: () => finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') }, false),
          }, { environment, report })
          return { status: 'missing', issue }
        }
        void inspect(connection.signal).then(async inspection => {
          if (!isCurrentAttempt()) return
          if (capabilitiesReady(inspection.report)) {
            const result = await prepareArchives(inspection.environment)
            if (result.status === 'missing') {
              preparingEnvironment = true
              resolve({ ok: false, reason: 'dependencies', issue: result.issue })
            }
            return
          }
          const issue = createDependencyPlan({
            sessionId, endpoint: endpointKey(profile), client, signal: connection.signal, purpose: 'connection', inspect,
            onReady: prepareArchives,
            onDiscard: () => finish({ ok: false, reason: 'other', message: msg('errors.connectionCancelled') }, false),
          }, inspection)
          // Keep the authenticated connection pending while the user reviews the proposal.
          preparingEnvironment = true
          resolve({ ok: false, reason: 'dependencies', issue })
        }).catch((error: unknown) => finish({ ok: false, reason: 'other', message: messageFromUnknown(error) }))
      } else if (rootScope) {
        rootScope.openRootTerminal(client, { term: 'xterm-256color', cols, rows }, startPath, connection.signal, (result) => {
          if ('error' in result) finish({ ok: false, reason: 'other', message: messageFromUnknown(result.error) })
          else activate(result.shell, undefined, result.output)
        })
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
          hostFingerprint = fingerprint
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

/** Lists `remotePath` for `sessionId` and records archive preparation after its first successful listing. */
export async function listDirectory(sessionId: string, remotePath: string): Promise<RemoteEntry[]> {
  const session = sessions.get(sessionId)
  const entries = await listRemoteDirectory(filesSession(sessionId).commands, remotePath)
  const platform = session?.platform
  if (session && platform?.pendingArchivePreparation && sessions.get(sessionId) === session) {
    saveArchivePreparation(session.profileId, platform.pendingArchivePreparation)
    platform.pendingArchivePreparation = undefined
  }
  return entries
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

