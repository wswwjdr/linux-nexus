import type { FileIdentity, FileElevationResult } from '@shared/types'
import { getMainWindow, sessions, type ActiveSession } from './runtime'
import { executeRemoteCommand, executeSudoCommand, RemoteTerminationError, SudoAuthenticationError,
  type RemoteCommandExecutor, type RemoteCommandOptions } from './ssh-commands'
import { cancelNameSearchesForSession } from './name-search'
import { cancelContentSearchesForSession } from './content-search'
import { cancelScriptExecutionsForSession } from './script-execution-runtime'
import { cancelRemoteOperationsForSession } from './remote-operations'
import { cancelTransfersForSession } from './transfers'
import { clearPreviewAssetsForSession } from './previews/preview-assets'
import { waitWithSignal } from './stream-utils'

export class FileCommandScope implements RemoteCommandExecutor {
  private readonly controller = new AbortController()
  private readonly work = new Set<Promise<unknown>>()
  private readonly commands = new Set<ReturnType<RemoteCommandExecutor['execute']>>()
  readonly signal = this.controller.signal

  constructor(
    private readonly client: ActiveSession['client'],
    private readonly sudo?: { password?: Buffer; onFailure: () => void },
  ) {}

  track<T>(operation: Promise<T>): Promise<T> {
    this.work.add(operation)
    const release = () => this.work.delete(operation)
    void operation.then(release, release)
    return operation
  }

  async waitForIdle(signal: AbortSignal): Promise<void> {
    while (this.work.size) await waitWithSignal(Promise.allSettled(this.work), signal)
    this.signal.throwIfAborted()
  }

  execute(command: string, options: RemoteCommandOptions = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, this.signal]) : this.signal
    if (signal.aborted) return executeRemoteCommand(this.client, command, { ...options, signal })
    const execution = this.sudo
      ? executeSudoCommand(this.client, command, this.sudo.password, { ...options, signal })
      : executeRemoteCommand(this.client, command, { ...options, signal })
    this.commands.add(execution)
    const release = () => this.commands.delete(execution)
    void execution.then(release, release)
    return this.track(execution.catch((error: unknown) => {
      if (error instanceof SudoAuthenticationError && !signal.aborted) this.sudo!.onFailure()
      throw error
    }))
  }

  async revoke(): Promise<boolean> {
    this.sudo?.password?.fill(0)
    const pending = [...this.commands]
    this.controller.abort()
    const results = await Promise.allSettled(pending)
    return results.some((result) => result.status === 'rejected'
      && result.reason instanceof RemoteTerminationError && result.reason.remoteState === 'unknown')
  }
}

interface FileIdentityState {
  identity: FileIdentity
  commands: FileCommandScope
  transition?: AbortController
}

const identities = new WeakMap<ActiveSession, FileIdentityState>()

function stateFor(session: ActiveSession): FileIdentityState {
  let state = identities.get(session)
  if (!state) {
    state = { identity: 'login', commands: new FileCommandScope(session.client) }
    identities.set(session, state)
  }
  return state
}

export function initializeFileIdentity(session: ActiveSession, effectiveUid: number): FileIdentity {
  const state = stateFor(session)
  state.identity = effectiveUid === 0 ? 'root-login' : 'login'
  return state.identity
}

export function fileCommands(session: ActiveSession): FileCommandScope {
  if (session.kind !== 'files') throw new Error('文件会话未连接')
  const state = stateFor(session)
  if (state.transition) throw new Error('正在切换文件会话身份')
  return state.commands
}

function connectedFileSession(sessionId: unknown): ActiveSession {
  const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
  if (session?.kind !== 'files') throw new Error('文件会话未连接')
  return session
}

export function revokeFileIdentity(session: ActiveSession): Promise<boolean> {
  const state = identities.get(session)
  if (!state) return Promise.resolve(false)
  state.transition?.abort()
  return state.commands.revoke()
}

export async function enterFileRoot(sessionId: unknown, value?: unknown): Promise<FileElevationResult> {
  const session = connectedFileSession(sessionId)
  if (value !== undefined && (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/.test(value))) {
    throw new Error('sudo 密码格式无效')
  }
  const state = stateFor(session)
  if (state.transition) throw new Error('正在切换文件会话身份')
  if (state.identity !== 'login') return { status: 'entered', identity: state.identity }
  const transition = new AbortController()
  state.transition = transition
  let password: Buffer | undefined
  try {
    await state.commands.waitForIdle(transition.signal)
    transition.signal.throwIfAborted()
    password = value === undefined ? undefined : Buffer.from(value + '\n')
    await executeSudoCommand(session.client, ':', password, { signal: transition.signal })
    transition.signal.throwIfAborted()
    void state.commands.revoke()
    clearPreviewAssetsForSession(session.sessionId)
    state.commands = new FileCommandScope(session.client, {
      password,
      onFailure: () => { void leaveFileRoot(session.sessionId, true) },
    })
    password = undefined
    state.identity = 'sudo-root'
    return { status: 'entered', identity: state.identity }
  } catch (error) {
    if (transition.signal.aborted) return { status: 'cancelled' }
    if (error instanceof SudoAuthenticationError && error.passwordRequired) return { status: 'password-required' }
    throw error
  } finally {
    password?.fill(0)
    if (state.transition === transition) state.transition = undefined
  }
}

export function cancelFileRootEntry(sessionId: unknown): void {
  const state = stateFor(connectedFileSession(sessionId))
  if (state.identity === 'login') state.transition?.abort()
}

export async function leaveFileRoot(sessionId: unknown, expired = false): Promise<{ remoteStateUnknown: boolean }> {
  const session = connectedFileSession(sessionId)
  const state = stateFor(session)
  if (state.transition) throw new Error('正在切换文件会话身份')
  if (state.identity !== 'sudo-root') return { remoteStateUnknown: false }
  const transition = new AbortController()
  state.transition = transition
  const stopped = state.commands.revoke()
  cancelNameSearchesForSession(session.sessionId)
  cancelContentSearchesForSession(session.sessionId)
  cancelScriptExecutionsForSession(session.sessionId)
  void cancelRemoteOperationsForSession(session.sessionId)
  cancelTransfersForSession(session.sessionId)
  clearPreviewAssetsForSession(session.sessionId)
  const remoteStateUnknown = await stopped
  if (sessions.get(session.sessionId) === session) {
    state.commands = new FileCommandScope(session.client)
    state.identity = 'login'
    state.transition = undefined
    const contents = getMainWindow()?.webContents
    if (expired && contents && !contents.isDestroyed()) {
      contents.send('files:root-expired', { sessionId: session.sessionId, remoteStateUnknown })
    }
  }
  return { remoteStateUnknown }
}
