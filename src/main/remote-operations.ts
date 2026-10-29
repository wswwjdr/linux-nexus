import { posix } from 'node:path'
import type {
  OperationExecutionRequest,
  OperationExecutionResult,
  OperationExecutionStrategy,
  RemoteOperationConfirmation,
  RemoteOperationIntent,
} from '@shared/types'
import { archiveBaseName, archiveFormatForName, type RemoteArchiveFormat } from '@shared/archive'
import { buildRemoteCommand, executeRemoteCommand } from './ssh-commands'
import { filesSession, normalizedRemotePath } from './remote-fs'

interface ActiveOperation {
  sessionId: string
  controller: AbortController
  promise: Promise<OperationExecutionResult>
}

const activeOperations = new Map<string, ActiveOperation>()

function validateIntent(value: RemoteOperationIntent): RemoteOperationIntent & { outputDirectory?: string } {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !['copy', 'move', 'extract'].includes(value.operation)
    || !['force', 'skip', 'update', 'confirm'].includes(value.strategy)
    || !Array.isArray(value.sourcePaths)
    || value.sourcePaths.some((path) => typeof path !== 'string')) throw new Error('远端操作参数无效')
  const sourcePaths = value.sourcePaths.map(normalizedRemotePath)
  const targetDirectory = normalizedRemotePath(value.targetDirectory)
  if (value.operation === 'extract') {
    if (sourcePaths.length !== 0 || typeof value.archivePath !== 'string' || !value.archivePath
      || typeof value.wrapInDirectory !== 'boolean') throw new Error('解压参数无效')
    const archivePath = normalizedRemotePath(value.archivePath)
    if (!archiveFormatForName(archivePath)) throw new Error('不支持的压缩包格式')
    const outputDirectory = value.wrapInDirectory
      ? posix.join(targetDirectory, archiveBaseName(posix.basename(archivePath)))
      : targetDirectory
    return { ...value, sourcePaths, targetDirectory, archivePath, outputDirectory }
  }
  if (sourcePaths.length === 0 || value.archivePath !== undefined || sourcePaths.includes('/')
    || new Set(sourcePaths).size !== sourcePaths.length) throw new Error('远端操作来源路径无效')
  if (sourcePaths.some((sourcePath) => targetDirectory === sourcePath || targetDirectory.startsWith(sourcePath + '/'))) {
    throw new Error('不能将文件夹复制或移动到自身或其子文件夹中')
  }
  return { ...value, sourcePaths, targetDirectory }
}

function strategyFlags(strategy: OperationExecutionStrategy): string[] {
  if (strategy === 'force') return ['-f']
  if (strategy === 'skip') return ['-n']
  return ['-u']
}

function archiveUnpackCommand(format: RemoteArchiveFormat, strategy: OperationExecutionStrategy): string {
  const policy = strategy === 'force' ? '--overwrite'
    : strategy === 'skip' ? '--skip-old-files'
      : '--keep-newer-files'
  if (format === 'zip') {
    const option = strategy === 'force' ? '-o' : strategy === 'skip' ? '-n' : '-u'
    return `unzip -qq ${option} -- "$archive" -d "$output"`
  }
  if (format === 'tar-gz') return `tar --no-same-owner --no-same-permissions ${policy} -xzf "$archive" -C "$output"`
  if (format === 'tar-bz2') return `tar --no-same-owner --no-same-permissions ${policy} -xjf "$archive" -C "$output"`
  if (format === 'tar-xz') return `tar --no-same-owner --no-same-permissions ${policy} -xJf "$archive" -C "$output"`
  if (format === 'tar-zst') return `zstd -dc -- "$archive" | tar --no-same-owner --no-same-permissions ${policy} -xf - -C "$output"`
  return `tar --no-same-owner --no-same-permissions ${policy} -xf "$archive" -C "$output"`
}

function operationCommandParts(
  intent: RemoteOperationIntent & { outputDirectory?: string },
  strategy: OperationExecutionStrategy,
): { script: string; args: string[] } {
  if (intent.operation !== 'extract') {
    const utility = intent.operation === 'copy' ? 'cp' : 'mv'
    const flags = strategyFlags(strategy)
    const copyOptions = intent.operation === 'copy' ? ['-R', '--preserve=mode,timestamps'] : []
    const optionText = [...copyOptions, ...flags].join(' ')
    return {
      script: `set -eu\n${utility}${optionText ? ' ' + optionText : ''} -- "$@"`,
      args: [...intent.sourcePaths, intent.targetDirectory],
    }
  }

  if (!intent.archivePath || !intent.outputDirectory) throw new Error('解压参数缺少目标路径')
  const format = archiveFormatForName(intent.archivePath)
  if (!format) throw new Error('不支持的压缩包格式')
  return {
    script: [
      'set -euo pipefail',
      'archive=$1; output=$2',
      'mkdir -p -- "$output"',
      archiveUnpackCommand(format, strategy),
    ].join('\n'),
    args: [intent.archivePath, intent.outputDirectory],
  }
}

function buildOperationCommand(
  intent: RemoteOperationIntent & { outputDirectory?: string },
  strategy: OperationExecutionStrategy,
): string {
  const parts = operationCommandParts(intent, strategy)
  return buildRemoteCommand(parts.script, parts.args)
}

export function composeRemoteOperation(value: RemoteOperationIntent): RemoteOperationConfirmation {
  const intent = validateIntent(value)
  return {
    ...intent,
    commandPreviews: {
      force: buildOperationCommand(intent, 'force'),
      skip: buildOperationCommand(intent, 'skip'),
      update: buildOperationCommand(intent, 'update'),
    },
  }
}

export function executeRemoteOperation(value: OperationExecutionRequest): Promise<OperationExecutionResult> {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !['force', 'skip', 'update'].includes(value.strategy)) throw new Error('远端操作参数无效')
  const intent = validateIntent({ ...value, strategy: value.strategy })
  const session = filesSession(intent.sessionId)
  const command = buildOperationCommand(intent, value.strategy)
  const controller = new AbortController()
  const promise = executeRemoteCommand(session.client, command, { signal: controller.signal, collectStdout: false })
    .then((): OperationExecutionResult => ({ status: 'completed', requestId: value.requestId, operation: intent.operation, command }))
    .catch((error: unknown) => {
      if (controller.signal.aborted) return { status: 'cancelled', requestId: value.requestId, operation: intent.operation, command }
      throw error
    })
    .finally(() => activeOperations.delete(value.requestId))
  activeOperations.set(value.requestId, { sessionId: session.sessionId, controller, promise })
  return promise
}

export function cancelRemoteOperation(requestId: string): boolean {
  const operation = activeOperations.get(requestId)
  if (!operation) return false
  operation.controller.abort()
  return true
}

export async function cancelRemoteOperationsForSession(sessionId: string): Promise<void[]> {
  const operations = [...activeOperations.entries()].filter(([, operation]) => operation.sessionId === sessionId)
  for (const [, operation] of operations) operation.controller.abort()
  return Promise.all(operations.map(([, operation]) => operation.promise.then(() => undefined, () => undefined)))
}
