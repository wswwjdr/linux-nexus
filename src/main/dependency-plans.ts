import { randomUUID } from 'node:crypto'
import type { Client } from 'ssh2'
import { LocalizedError, msg } from '../shared/i18n/messages.ts'
import type { DependencyCheckResult, DependencyInstallResult, DependencyIssue, DependencyPurpose } from '../shared/types/dependencies.ts'
import { selectPackageManager, type PackageManagerStrategy } from './package-manager.ts'
import { archiveCapabilities, capabilitiesReady, type Capability, type CapabilityReport, type ServerEnvironment } from './server-capabilities.ts'
import { executeBootstrapSudo, executeRemoteCommand, RemoteCommandError, RemoteTerminationError, SudoAuthenticationError } from './ssh-commands.ts'

type Ready = Extract<DependencyCheckResult, { status: 'ready' }>
type Inspection = { environment: ServerEnvironment; report: CapabilityReport }

export interface DependencyContext {
  sessionId: string
  endpoint: string
  client: Client
  signal: AbortSignal
  purpose: DependencyPurpose
  inspect: (signal: AbortSignal) => Promise<Inspection>
  onReady?: (environment: ServerEnvironment) => DependencyCheckResult | Promise<DependencyCheckResult>
  onSkip?: (environment: ServerEnvironment) => Ready
  onDiscard?: () => void
}

interface DependencyInstallPlan {
  issue: DependencyIssue
  strategy?: PackageManagerStrategy
  context: DependencyContext
  controller: AbortController
  signal: AbortSignal
  cleanup: () => void
  busy: boolean
  attempted: boolean
  environment: ServerEnvironment
}

const plans = new Map<string, DependencyInstallPlan>()
const installing = new Set<string>()

/** Returns the proposal for `id` and its `context` using `inspection`, disabling further installs if already `attempted`. */
function propose(id: string, context: DependencyContext, inspection: Inspection, attempted: boolean) {
  const { environment, report } = inspection
  const strategy = selectPackageManager(environment)
  const mapped = report.missing.map(tool => strategy?.packages[tool])
  const optional = context.purpose === 'archive-setup'
  const packages = mapped.filter((name): name is string => Boolean(name))
  const installable = !attempted && (environment.effectiveUid === 0 || environment.canSudo) && packages.length > 0
    && (optional || (!report.incompatible.length && packages.length === mapped.length))
  const blocked = new Set<Capability>([...report.missing, ...report.incompatible])
  return {
    strategy: installable ? strategy : undefined,
    issue: {
      id, purpose: context.purpose, missing: report.missing, incompatible: report.incompatible,
      manager: installable ? strategy?.manager : undefined,
      packages: installable ? [...new Set(packages)] : [],
      ...(optional && { formats: Object.entries(archiveCapabilities).filter(([, tools]) => tools.some(tool => blocked.has(tool))).map(([format]) => format) }),
    },
  }
}

/** Invalidates `plan`, aborts its work, and ends the enclosing flow if `discard` is set. */
function remove(plan: DependencyInstallPlan, discard: boolean): void {
  if (!plans.delete(plan.issue.id)) return
  plan.cleanup()
  plan.controller.abort()
  if (discard) plan.context.onDiscard?.()
}

/** Registers a plan bound to the live session in `context` and returns a proposal based on `inspection`. */
export function createDependencyPlan(context: DependencyContext, inspection: Inspection): DependencyIssue {
  context.signal.throwIfAborted()
  for (const previous of plans.values()) {
    if (previous.context.sessionId === context.sessionId && previous.context.purpose === context.purpose) {
      if (previous.busy) throw new LocalizedError(msg('errors.dependencyPlanBusy'))
      remove(previous, false)
    }
  }
  const proposal = propose(randomUUID(), context, inspection, false)
  const controller = new AbortController()
  const expire = () => remove(plan, true)
  const timer = setTimeout(expire, 15 * 60_000).unref()
  const plan: DependencyInstallPlan = {
    ...proposal, context, controller, signal: AbortSignal.any([context.signal, controller.signal]), busy: false,
    attempted: false, environment: inspection.environment,
    cleanup: () => { clearTimeout(timer); context.signal.removeEventListener('abort', expire) },
  }
  context.signal.addEventListener('abort', expire, { once: true })
  plans.set(plan.issue.id, plan)
  return plan.issue
}

/** Validates the IPC identifier `id` and returns an idle, live plan. */
function currentPlan(id: unknown): DependencyInstallPlan {
  const plan = typeof id === 'string' ? plans.get(id) : undefined
  if (!plan || plan.signal.aborted) throw new LocalizedError(msg('errors.dependencyPlanExpired'))
  if (plan.busy) throw new LocalizedError(msg('errors.dependencyPlanBusy'))
  return plan
}

/** Reprobes the dependencies for `plan` and returns either an updated proposal or readiness. */
async function refresh(plan: DependencyInstallPlan): Promise<DependencyCheckResult> {
  const inspection = await plan.context.inspect(plan.signal)
  plan.signal.throwIfAborted()
  if (capabilitiesReady(inspection.report)) {
    const result = await plan.context.onReady?.(inspection.environment) ?? { status: 'ready' }
    remove(plan, false)
    return result
  }
  Object.assign(plan, propose(plan.issue.id, plan.context, inspection, plan.attempted), { environment: inspection.environment })
  return { status: 'missing', issue: plan.issue }
}

/** Returns a fresh capability result for the proposal `id` without installing packages. */
export async function recheckDependencies(id: unknown): Promise<DependencyCheckResult> {
  const plan = currentPlan(id)
  plan.busy = true
  try { return await refresh(plan) }
  finally { plan.busy = false }
}

/**
 * Installs only the packages in the confirmed plan.
 * @param id Proposal identifier validated against a live session.
 * @param password Optional sudo password received from the confirmation dialog.
 * @returns Whether the installer completed or requires sudo authentication. The caller rechecks before resuming.
 */
export async function installDependencies(id: unknown, password: unknown): Promise<DependencyInstallResult> {
  const plan = currentPlan(id)
  if (password !== undefined && (typeof password !== 'string' || !password || password.length > 4096 || /[\0\r\n]/.test(password))) {
    throw new LocalizedError(msg('errors.invalidSudoPasswordFormat'))
  }
  if (!plan.strategy || plan.attempted) throw new LocalizedError(msg('errors.dependencyInstallUnavailable'))
  const { client, endpoint } = plan.context
  if (installing.has(endpoint)) throw new LocalizedError(msg('errors.dependencyPlanBusy'))
  const command = plan.strategy.install(plan.issue.packages)
  const secret = typeof password === 'string' ? Buffer.from(password + '\n') : undefined
  const options = { signal: plan.signal, timeoutMs: 5 * 60_000, maxStderrBytes: 8192 }
  installing.add(endpoint)
  plan.busy = true
  let output = ''
  try {
    const commandOptions = { ...options, collectStdout: false, onStdout: (chunk: Buffer) => { output = (output + chunk.toString()).slice(-2048) } }
    try {
      if (plan.environment.effectiveUid === 0) await executeRemoteCommand(client, command, commandOptions)
      else await executeBootstrapSudo(client, command, secret, commandOptions)
    } catch (error) {
      if (error instanceof SudoAuthenticationError) {
        if (error.passwordRequired && password === undefined) return { status: 'password-required' }
        if (password !== undefined) return { status: 'password-required', message: error.localizedMessage }
        throw error
      }
      plan.attempted = true
      if (error instanceof RemoteCommandError && error.exitCode !== null) {
        throw new LocalizedError(error.stderr.trim() || output.trim() || msg('errors.dependencyInstallFailed'))
      }
      if (error instanceof LocalizedError && (!(error instanceof RemoteTerminationError) || error.remoteState === 'unknown')) {
        throw new LocalizedError(msg('errors.dependencyInstallStateUnknown'))
      }
      throw error
    }
    plan.attempted = true
    return { status: 'installed' }
  } finally {
    secret?.fill(0)
    installing.delete(endpoint)
    plan.busy = false
  }
}

/** Cancels the installation or recheck associated with proposal `id`. */
export function cancelDependencies(id: unknown): void {
  const plan = typeof id === 'string' ? plans.get(id) : undefined
  if (plan) remove(plan, true)
}

/** Completes the connection represented by optional archive proposal `id` without installing packages. */
export function skipArchivePreparation(id: unknown): Ready {
  const plan = currentPlan(id)
  if (!plan.context.onSkip) throw new LocalizedError(msg('errors.dependencyInstallUnavailable'))
  const result = plan.context.onSkip(plan.environment)
  remove(plan, false)
  return result
}
