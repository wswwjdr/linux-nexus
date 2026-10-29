import { posix } from 'node:path'
import type {
  OperationExecutionRequest,
  OperationExecutionResult,
  OperationExecutionStrategy,
} from '@shared/types'
import { archiveBaseName, archiveFormatForName, type RemoteArchiveFormat } from '@shared/archive'
import { buildRemoteCommand, executeRemoteCommand, RemoteCommandError } from './ssh-commands'
import { filesSession, normalizedRemotePath } from './remote-fs'

interface ActiveOperation {
  sessionId: string
  controller: AbortController
  promise: Promise<OperationExecutionResult>
}

const activeOperations = new Map<string, ActiveOperation>()

function validateRequest(value: OperationExecutionRequest): OperationExecutionRequest & { outputDirectory?: string } {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !['copy', 'move', 'extract'].includes(value.operation)
    || !['force', 'skip', 'update'].includes(value.strategy)
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
  if (value.strategy === 'update') throw new Error('复制和移动仅支持覆盖或跳过策略')
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

const copyInPlaceScript = `
copy_in_place() {
  local source=$1 name stem extension='' destination reservation_error index=2 is_directory=0
  name=\${source##*/}
  stem=$name
  if [[ ! -L "$source" && -d "$source" ]]; then
    is_directory=1
  elif [[ ! -L "$source" && -f "$source" ]]; then
    if [[ "\${name:1}" == *.* ]]; then
      stem=\${name%.*}
      extension=.\${name##*.}
    fi
  else
    printf '%s\\n' "只能复制普通文件或文件夹，来源可能已不存在：$source" >&2
    exit 1
  fi
  while :; do
    destination="$target/$stem($index)$extension"
    index=$((index + 1))
    [[ ! -e "$destination" && ! -L "$destination" ]] || continue
    # Reserve the name before copying so simultaneous pastes cannot overwrite each other.
    if (( is_directory )); then
      if reservation_error=$(mkdir -- "$destination" 2>&1); then break; fi
    else
      if reservation_error=$( (set -o noclobber; : > "$destination") 2>&1); then break; fi
    fi
    [[ -e "$destination" || -L "$destination" ]] && continue
    printf '%s\\n' "$reservation_error" >&2
    exit 1
  done
  cp -R --preserve=mode,timestamps -fT -- "$source" "$destination"
}
`.trim()

function archiveUnpackCommand(format: RemoteArchiveFormat, strategy: OperationExecutionStrategy): string {
  const policy = strategy === 'force' ? '--overwrite'
    : strategy === 'skip' ? '--skip-old-files'
      : '--keep-newer-files'
  if (format === 'zip') {
    const option = strategy === 'force' ? '-o' : strategy === 'skip' ? '-n' : '-u'
    // Include stdout diagnostics so warnings cannot hide skipped files or other errors.
    return `unzip -qq ${option} -- "$archive" -d "$output" 1>&2`
  }
  if (format === 'tar-gz') return `tar --no-same-owner --no-same-permissions ${policy} -xzf "$archive" -C "$output"`
  if (format === 'tar-bz2') return `tar --no-same-owner --no-same-permissions ${policy} -xjf "$archive" -C "$output"`
  if (format === 'tar-xz') return `tar --no-same-owner --no-same-permissions ${policy} -xJf "$archive" -C "$output"`
  if (format === 'tar-zst') return `zstd -dc -- "$archive" | tar --no-same-owner --no-same-permissions ${policy} -xf - -C "$output"`
  return `tar --no-same-owner --no-same-permissions ${policy} -xf "$archive" -C "$output"`
}

function operationCommandParts(
  intent: OperationExecutionRequest & { outputDirectory?: string },
  strategy: OperationExecutionStrategy,
): { script: string; args: string[] } {
  if (intent.operation !== 'extract') {
    const utility = intent.operation === 'copy' ? 'cp' : 'mv'
    const flags = strategyFlags(strategy)
    const copyOptions = intent.operation === 'copy' ? ['-R', '--preserve=mode,timestamps'] : []
    const optionText = [...copyOptions, ...flags].join(' ')
    return {
      script: [
        'set -eu',
        'target=$1; shift',
        ...(intent.operation === 'copy' ? [copyInPlaceScript] : []),
        'pending=()',
        'for source in "$@"; do',
        '  parent=${source%/*}; parent=${parent:-/}',
        // Compare directory identities too, so aliases through symlinks behave like the original path.
        '  if [[ "$target" -ef "$parent" ]]; then',
        ...(intent.operation === 'copy' ? ['    copy_in_place "$source"'] : [
          '    [[ -e "$source" || -L "$source" ]] || { printf "%s\\n" "移动来源已不存在：$source" >&2; exit 1; }',
        ]),
        '  else',
        '    pending+=("$source")',
        '  fi',
        'done',
        'if (( ${#pending[@]} )); then',
        '  set -- "${pending[@]}" "$target"',
        `  ${utility}${optionText ? ' ' + optionText : ''} -- "$@"`,
        'fi',
      ].join('\n'),
      args: [intent.targetDirectory, ...intent.sourcePaths],
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
  intent: OperationExecutionRequest & { outputDirectory?: string },
  strategy: OperationExecutionStrategy,
): string {
  const parts = operationCommandParts(intent, strategy)
  return buildRemoteCommand(parts.script, parts.args)
}

export function executeRemoteOperation(value: OperationExecutionRequest): Promise<OperationExecutionResult> {
  const intent = validateRequest(value)
  if (activeOperations.has(intent.requestId)) throw new Error('远端操作编号重复')
  const session = filesSession(intent.sessionId)
  const command = buildOperationCommand(intent, value.strategy)
  const controller = new AbortController()
  const promise = executeRemoteCommand(session.client, command, { signal: controller.signal, collectStdout: false })
    .then((): OperationExecutionResult => ({ status: 'completed', requestId: value.requestId, operation: intent.operation, command }))
    .catch((error: unknown): OperationExecutionResult => {
      if (controller.signal.aborted) return { status: 'cancelled', requestId: value.requestId, operation: intent.operation, command }
      // UnZip exit 1 can also mean skipped files; accept only this exact compatibility warning.
      if (intent.operation === 'extract' && archiveFormatForName(intent.archivePath!) === 'zip'
        && error instanceof RemoteCommandError && error.exitCode === 1
        && error.stderr.trim().replace(/^warning:[ \t]+/, 'warning: ')
          === `warning: ${intent.archivePath} appears to use backslashes as path separators`) {
        return {
          status: 'completed', requestId: value.requestId, operation: intent.operation, command,
        }
      }
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
