import type { DependencyIssue, DependencyPurpose } from '../shared/types/dependencies.ts'
import { createDependencyPlan } from './dependency-plans.ts'
import { fileCommands } from './file-identity.ts'
import { capabilitiesReady, checkCapabilities, fileCapabilities, inspectServer, type Capability, type CapabilityReport, type FileCapabilityPurpose } from './server-capabilities.ts'
import { sessions } from './runtime.ts'
import { DependencyRequiredError } from '../shared/dependency-error'
import { filesSession } from './remote-fs'

/** Checks the tools needed by `purpose` before the operation runs under `session`. */
export async function verifyFileOperation(session: ReturnType<typeof filesSession>, purpose: FileCapabilityPurpose, signal?: AbortSignal): Promise<void> {
  const required = fileCapabilities[purpose]
  const report = await checkCapabilities(session.commands, required, signal)
  signal?.throwIfAborted()
  session.commands.signal.throwIfAborted()
  if (!capabilitiesReady(report)) throw new DependencyRequiredError(offerFileDependencies(session.sessionId, session.commands, purpose, required, report))
}

/**
 * Runs an IPC operation only after its tools have passed preflight under the active file identity.
 * @param sessionId Active file session identifier.
 * @param purpose Feature whose required capabilities determine the preflight.
 * @param run Operation to execute on successful preflight.
 * @returns The operation result.
 */
export function withFileCapabilities<T>(sessionId: string, purpose: FileCapabilityPurpose, run: () => Promise<T> | T): Promise<T> {
  const session = filesSession(sessionId)
  return session.commands.track(verifyFileOperation(session, purpose).then(run))
}

/**
 * Offers dependency setup for a file operation that stopped at preflight.
 * @param sessionId Active file session that reported the missing capability.
 * @param commands Exact remote command scope used to execute the operation.
 * @param purpose Operation requiring these dependencies.
 * @param required Capabilities to verify again under the same command scope.
 * @param report Missing and incompatible tools from the original preflight.
 * @returns The proposal displayed by the renderer.
 */
export function offerFileDependencies(sessionId: string, commands: ReturnType<typeof fileCommands>,
  purpose: Exclude<DependencyPurpose, 'connection' | 'archive-setup'>, required: readonly Capability[], report: CapabilityReport): DependencyIssue {
  commands.signal.throwIfAborted()
  const session = sessions.get(sessionId)
  const platform = session?.platform
  if (!session || !platform || fileCommands(session) !== commands) throw new Error('Missing file capability context for the active command scope')
  return createDependencyPlan({
    sessionId, endpoint: platform.endpoint, client: session.client, signal: commands.signal, purpose,
    inspect: async signal => {
      const [environment, report] = await Promise.all([
        inspectServer(session.client, signal), checkCapabilities(commands, required, signal),
      ])
      signal.throwIfAborted()
      platform.environment = environment
      return { environment, report }
    },
  }, { environment: platform.environment, report })
}
