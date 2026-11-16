import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { LocalizedError, msg, tr, type MessageKey, type MessageValue } from '@shared/i18n/messages'
import type { DependencyCheckResult, DependencyIssue, DependencyPurpose } from '@shared/types'
import { DependencyRequiredError } from '@shared/dependency-error'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { errorMessage } from '@/app-utils'
import { useLanguage } from '@/i18n'

type Ready = Extract<DependencyCheckResult, { status: 'ready' }>
type RequestDependencies = (issue: DependencyIssue, sessionId: string, target: string, signal?: AbortSignal) => Promise<Ready | null>
interface Request {
  issue: DependencyIssue
  sessionId: string
  target: string
  resolve: (result: Ready | null) => void
  reject: (error: MessageValue) => void
  release: () => void
}

const DependencyContext = createContext<RequestDependencies | null>(null)
const purposeLabels = {
  connection: 'dependencies.connection', 'archive-setup': 'dependencies.archiveSetup', extract: 'common.extract',
  'text-save': 'previews.saveRemoteFile', 'media-preview': 'dependencies.rangePreview', 'log-preview': 'dependencies.logPreview',
  'image-preview': 'files.preview', 'text-preview': 'files.preview', 'markdown-preview': 'files.preview',
  download: 'transfers.download', upload: 'transfers.upload', 'content-search': 'search.search',
  properties: 'files.properties', 'directory-stats': 'files.properties',
  'create-directory': 'dependencies.createDirectory', rename: 'files.rename', 'resolve-link': 'dependencies.connection',
  delete: 'files.delete', copy: 'common.copy', move: 'common.move',
} as const satisfies Record<DependencyPurpose, MessageKey>

/** The user declined the dependencies of an operation that never started. */
export class DependencyCancelledError extends LocalizedError {
  constructor() { super(msg('dependencies.cancelled')) }
}

/** Returns a runner that retries an operation once after its preflight is resolved. */
export function useFileDependencyAction() {
  const confirm = useDependencyConfirmation()
  return useCallback(async <T,>(run: () => Promise<T>, sessionId: string, target: string, signal?: AbortSignal, onPrompt?: () => void): Promise<T> => {
    signal?.throwIfAborted()
    try { return await run() }
    catch (error) {
      if (!(error instanceof DependencyRequiredError)) throw error
      if (signal?.aborted) {
        await unavailable(error.issue)
        throw new DependencyCancelledError()
      }
      onPrompt?.()
      if (!await confirm(error.issue, sessionId, target, signal)) throw new DependencyCancelledError()
      signal?.throwIfAborted()
    }
    try { return await run() }
    catch (error) {
      if (error instanceof DependencyRequiredError) await unavailable(error.issue)
      throw error
    }
  }, [confirm])
}

/** Returns the shared dependency confirmation function for the current workspace. */
export function useDependencyConfirmation(): RequestDependencies {
  const confirm = useContext(DependencyContext)
  return confirm ?? unavailable
}

/** Cancels `issue` and returns null when a workspace has no confirmation provider. */
async function unavailable(issue: DependencyIssue): Promise<null> {
  await window.remoteFiles.cancelDependencies(issue.id)
  return null
}

/** Renders workspace `children` and the shared confirmation dialog for dependency proposals. */
export function DependencyProvider({ children }: { children: ReactNode }) {
  useLanguage()
  const current = useRef<Request | null>(null)
  const working = useRef(false)
  const [request, setRequest] = useState<Request | null>(null)
  const [phase, setPhase] = useState<'install' | 'check' | null>(null)
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<MessageValue | null>(null)
  const [checkOnly, setCheckOnly] = useState(false)

  /** Closes the current proposal and settles its workflow with `result` or `failure`. */
  const finish = useCallback((result: Ready | null, failure?: MessageValue) => {
    const pending = current.current
    if (!pending) return
    current.current = null
    pending.release()
    if (!result) void window.remoteFiles.cancelDependencies(pending.issue.id).catch(() => {})
    setRequest(null)
    setPasswordRequired(false)
    setPassword('')
    setError(null)
    setCheckOnly(false)
    working.current = false
    setPhase(null)
    if (failure) pending.reject(failure)
    else pending.resolve(result)
  }, [])

  /** Handles Escape before the feature dialog underneath this provider. */
  const dismissOnEscape = useEffectEvent((event: KeyboardEvent) => {
    const pending = current.current
    if (!pending || event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (working.current && pending.issue.purpose === 'archive-setup') return
    finish(null, phase === 'install' ? msg('errors.dependencyInstallStateUnknown') : undefined)
  })

  useEffect(() => {
    const unsubscribe = window.remoteFiles.onConnectionClosed?.(event => {
      if (current.current?.sessionId !== event.sessionId) return
      // Let an active installer report whether its remote state is known.
      if (!working.current) finish(null)
    })
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => {
      window.removeEventListener('keydown', dismissOnEscape, true)
      unsubscribe?.()
      finish(null)
    }
  }, [finish])

  /** Shows `issue` for `sessionId` and `target`, resolving on readiness or cancellation via `signal`. */
  const confirm = useCallback<RequestDependencies>((issue, sessionId, target, signal) => {
    if (signal?.aborted) return unavailable(issue)
    if (current.current) {
      return unavailable(issue).then(() => { throw msg('errors.dependencyPlanBusy') })
    }
    return new Promise((resolve, reject) => {
      const abort = () => finish(null)
      const next = { issue, sessionId, target, resolve, reject, release: () => signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      current.current = next
      setRequest(next)
    })
  }, [finish])

  /** Runs the selected `action` and displays its progress and result. */
  const submit = async (action: 'install' | 'check') => {
    const pending = current.current
    if (!pending || working.current || (action === 'install' && passwordRequired && !password)) return
    working.current = true
    setPhase(action)
    setError(null)
    const secret = passwordRequired ? password : undefined
    setPassword('')
    try {
      if (action === 'install') {
        const installation = await window.remoteFiles.installDependencies(pending.issue.id, secret)
        if (current.current !== pending) return
        if (installation.status === 'password-required') {
          setPasswordRequired(true)
          setError(installation.message ?? null)
          return
        }
        setPasswordRequired(false)
        setPhase('check')
      }
      const result = await window.remoteFiles.recheckDependencies(pending.issue.id)
      if (current.current !== pending) return
      if (result.status === 'ready') {
        finish(result)
      } else {
        const previousPurpose = pending.issue.purpose
        pending.issue = result.issue
        setRequest({ ...pending })
        setPasswordRequired(false)
        setCheckOnly(false)
        if (action === 'install' && result.issue.purpose === previousPurpose) setError(msg('errors.dependencyStillMissing'))
      }
    } catch (cause) {
      if (current.current !== pending) return
      setError(errorMessage(cause))
      setPasswordRequired(false)
      if (action === 'install') setCheckOnly(true)
    } finally {
      if (current.current === pending) {
        working.current = false
        setPhase(null)
      }
    }
  }

  const issue = request?.issue
  const canInstall = Boolean(issue?.manager && issue.packages.length && !checkOnly)
  const optional = issue?.purpose === 'archive-setup'

  /** Enters the file session after explicitly skipping this optional archive proposal. */
  const skip = async () => {
    const pending = current.current
    if (!pending || working.current || pending.issue.purpose !== 'archive-setup') return
    working.current = true
    setPhase('check')
    try {
      const result = await window.remoteFiles.skipArchivePreparation(pending.issue.id)
      if (current.current === pending) finish(result)
    } catch (cause) {
      if (current.current === pending) setError(errorMessage(cause))
    } finally {
      if (current.current === pending) { working.current = false; setPhase(null) }
    }
  }

  return <DependencyContext.Provider value={confirm}>
    {children}
    {request && issue && <ConfirmationDialog
      title={tr(passwordRequired ? 'dependencies.authenticate' : optional ? 'dependencies.archiveTitle' : canInstall ? 'dependencies.installTitle' : 'dependencies.prepareTitle')}
      description={tr(passwordRequired ? 'dependencies.passwordHint' : optional ? 'dependencies.archiveHint' : canInstall ? 'dependencies.installHint' : 'dependencies.manualHint')}
      details={[
        { label: tr('dependencies.purpose'), value: tr(purposeLabels[issue.purpose]) },
        { label: tr('dependencies.target'), value: request.target },
        ...(issue.missing.length ? [{ label: tr('dependencies.missing'), value: issue.missing.join(', ') }] : []),
        ...(issue.incompatible.length ? [{ label: tr('dependencies.incompatible'), value: issue.incompatible.join(', ') }] : []),
        ...(issue.incompatible.includes('dd') ? [{ label: 'dd', value: tr('dependencies.ddByteRange') }] : []),
        ...(issue.formats?.length ? [{ label: tr('dependencies.archiveFormats'), value: issue.formats.map(format => '.' + format.replace('-', '.')).join(', ') }] : []),
        ...(canInstall ? [
          { label: tr('dependencies.manager'), value: issue.manager! },
          { label: tr('dependencies.packages'), value: issue.packages.join(', ') },
        ] : []),
      ]}
      tone="warning"
      priority
      confirmLabel={tr(canInstall ? 'dependencies.install' : 'dependencies.recheck')}
      confirmDisabled={passwordRequired && !password}
      secondaryActionLabel={canInstall ? tr('dependencies.recheck') : undefined}
      onSecondaryAction={() => void submit('check')}
      focusCancel={!passwordRequired}
      busy={phase !== null}
      allowBusyCancel={!optional}
      cancelLabel={optional ? tr('dependencies.skipArchive') : undefined}
      busyLabel={tr(phase === 'install' ? 'dependencies.installing' : 'dependencies.checking')}
      error={error}
      onConfirm={() => void submit(canInstall ? 'install' : 'check')}
      onCancel={() => { if (optional) void skip(); else finish(null, phase === 'install' ? msg('errors.dependencyInstallStateUnknown') : undefined) }}
      onDismiss={optional ? () => finish(null) : undefined}
    >
      {passwordRequired && <label className="field confirmation-field">
        <span>{tr('files.sudoPassword')}</span>
        <input type="password" autoComplete="off" autoFocus value={password} disabled={phase !== null}
          onChange={event => setPassword(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) void submit('install') }}
        />
      </label>}
    </ConfirmationDialog>}
  </DependencyContext.Provider>
}
