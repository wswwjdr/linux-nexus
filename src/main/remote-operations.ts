import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { Readable } from 'node:stream'
import type {
  OperationConflict,
  OperationExecutionRequest,
  OperationExecutionResult,
  OperationPreflight,
  OperationPreflightRequest,
  OperationStrategy,
  OperationExecutionStrategy,
  ArchiveDependency,
} from '@shared/types'
import { buildRemoteCommand, executeRemoteCommand, runRemoteCommand } from './ssh-commands'
import { filesSession, normalizedRemotePath } from './remote-fs'
import { archiveBaseName, archiveFormatForName, type RemoteArchiveFormat } from '@shared/archive'

interface StoredPreflight extends OperationPreflight {
  expiresAt: number
}

interface ActiveOperation {
  sessionId: string
  controller: AbortController
  promise: Promise<unknown>
}

const preflights = new Map<string, StoredPreflight>()
const activeOperations = new Map<string, ActiveOperation>()
const PREFLIGHT_TTL_MS = 10 * 60_000

function validateRequest(value: OperationPreflightRequest): OperationPreflightRequest {
  if (!value || typeof value !== 'object'
    || typeof value.requestId !== 'string' || !value.requestId
    || typeof value.sessionId !== 'string' || !value.sessionId
    || !['copy', 'move', 'extract'].includes(value.operation)
    || !['force', 'skip', 'update', 'confirm'].includes(value.strategy)
    || !Array.isArray(value.sourcePaths)
    || value.sourcePaths.some((path) => typeof path !== 'string')) throw new Error('远端操作预检参数无效')
  const sourcePaths = value.sourcePaths.map(normalizedRemotePath)
  const targetDirectory = normalizedRemotePath(value.targetDirectory)
  if (value.operation === 'extract') {
    if (sourcePaths.length !== 0 || typeof value.archivePath !== 'string' || !value.archivePath
      || typeof value.wrapInDirectory !== 'boolean') throw new Error('解压预检参数无效')
    normalizedRemotePath(value.archivePath)
    if (!archiveFormatForName(value.archivePath)) throw new Error('不支持的压缩包格式')
    return { ...value, sourcePaths, targetDirectory, archivePath: normalizedRemotePath(value.archivePath) }
  }
  if (sourcePaths.length === 0 || value.archivePath !== undefined || sourcePaths.includes('/') || new Set(sourcePaths).size !== sourcePaths.length) {
    throw new Error('远端操作来源路径无效')
  }
  if (sourcePaths.some((sourcePath) => targetDirectory === sourcePath || targetDirectory.startsWith(sourcePath + '/'))) {
    throw new Error('不能将文件夹复制或移动到自身或其子文件夹中')
  }
  return { ...value, sourcePaths, targetDirectory }
}

function strategyFlags(operation: 'copy' | 'move', strategy: Exclude<OperationStrategy, 'confirm'>): string[] {
  if (strategy === 'force') return ['-f']
  if (strategy === 'skip') return ['-n']
  if (strategy === 'update') return ['-u']
  throw new Error('远端操作策略无效：' + operation)
}

function requiredArchiveDependencies(archivePath: string): ArchiveDependency[] {
  const format = archiveFormatForName(archivePath)
  if (format === 'zip') return ['unzip']
  if (format === 'tar-gz') return ['gzip']
  if (format === 'tar-bz2') return ['bzip2']
  if (format === 'tar-xz') return ['xz']
  if (format === 'tar-zst') return ['zstd']
  return []
}

function archiveUnpackCommand(format: RemoteArchiveFormat): string {
  if (format === 'zip') return 'unzip -qq "$archive" -d "$payload"'
  if (format === 'tar-gz') return 'tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$payload"'
  if (format === 'tar-bz2') return 'tar --no-same-owner --no-same-permissions -xjf "$archive" -C "$payload"'
  if (format === 'tar-xz') return 'tar --no-same-owner --no-same-permissions -xJf "$archive" -C "$payload"'
  if (format === 'tar-zst') return 'zstd -dc -- "$archive" | tar --no-same-owner --no-same-permissions -xf - -C "$payload"'
  return 'tar --no-same-owner --no-same-permissions -xf "$archive" -C "$payload"'
}

function operationCommandParts(
  operation: OperationPreflight['operation'],
  sourcePaths: string[],
  targetDirectory: string,
  strategy: OperationExecutionStrategy,
  archivePath?: string,
  outputDirectory?: string,
): { script: string; args: string[] } {
  if (operation !== 'extract') {
    const utility = operation === 'copy' ? 'cp' : 'mv'
    const flags = strategyFlags(operation, strategy)
    const copyOptions = operation === 'copy' ? ['-R', '--preserve=mode,timestamps'] : []
    const optionText = [...copyOptions, ...flags].join(' ')
    return { script: `set -eu\n${utility}${optionText ? ' ' + optionText : ''} -- "$@"`, args: [...sourcePaths, targetDirectory] }
  }
  if (!archivePath || !outputDirectory) throw new Error('解压预检记录缺少归档路径')
  const format = archiveFormatForName(archivePath)
  if (!format) throw new Error('不支持的压缩包格式')
  const unpack = archiveUnpackCommand(format)
  const copyFlags = strategyFlags('copy', strategy).join(' ')
  const flags = copyFlags ? ' ' + copyFlags : ''
  const script = [
    'set -euo pipefail',
    'umask 077',
    'archive=$1; target=$2; output=$3',
    'stage=$(mktemp -d "${TMPDIR:-/tmp}/linux-nexus-extract.XXXXXX")',
    'payload=$stage/payload; mkdir -- "$payload"',
    'trap \'rm -rf -- "$stage"\' EXIT',
    'trap \'exit 129\' HUP',
    'trap \'exit 130\' INT',
    'trap \'exit 143\' TERM',
    unpack,
    'chmod -R u+rwX,go-rwx -- "$payload"',
    'unsupported=$(find -- "$payload" -mindepth 1 ! \\( -type f -o -type d \\) -print -quit)',
    'if [[ -n "$unsupported" ]]; then printf "%s\\n" "解压内容包含符号链接或特殊文件" >&2; exit 1; fi',
    'members=$stage/members; find -- "$payload" -mindepth 1 -print0 > "$members"',
    'mkdir -p -- "$output"',
    `cp -R${flags} -- "$payload/." "$output/"`,
    'rm -rf -- "$stage"',
    'trap - EXIT HUP INT TERM',
  ].filter(Boolean).join('\n')
  return { script, args: [archivePath, targetDirectory, outputDirectory] }
}

export function buildRemoteOperationCommand(preflight: Pick<OperationPreflight, 'operation' | 'sourcePaths' | 'targetDirectory' | 'archivePath' | 'outputDirectory'>, strategy: OperationExecutionStrategy): string {
  const parts = operationCommandParts(preflight.operation, preflight.sourcePaths, preflight.targetDirectory,
    strategy, preflight.archivePath, preflight.outputDirectory)
  return buildRemoteCommand(parts.script, parts.args)
}

const commandPreview = buildRemoteOperationCommand

const preflightScript = [
  'set -eu',
  'target=$1; shift',
  '[[ -d "$target" && ! -L "$target" ]] || { printf "%s\\n" "操作目标不是普通文件夹" >&2; exit 1; }',
  'stage=$(mktemp -d "${TMPDIR:-/tmp}/linux-nexus-preflight.XXXXXX")',
  'members=$stage/members',
  'trap \'rm -rf -- "$stage"\' EXIT',
  'trap \'exit 129\' HUP',
  'trap \'exit 130\' INT',
  'trap \'exit 143\' TERM',
  'for source in "$@"; do',
  '  [[ ! -L "$source" && ( -f "$source" || -d "$source" ) ]] || { printf "来源不是普通文件或文件夹: %s\\n" "$source" >&2; exit 1; }',
  '  if [[ -d "$source" ]]; then',
  '    unsupported=$(find -- "$source" ! \\( -type f -o -type d \\) -print -quit)',
  '    if [[ -n "$unsupported" ]]; then printf "来源包含符号链接或特殊文件: %s\\n" "$source" >&2; exit 1; fi',
  '  fi',
  '  name=${source##*/}; root="$target/$name"',
  '  if [[ -d "$source" ]]; then',
  '    find -- "$source" -print0 > "$members"',
  '    while IFS= read -r -d "" member; do',
  '      relative=${member#"$source"}; relative=${relative#/}',
  '      destination="$root${relative:+/$relative}"',
  '      if [[ -e "$destination" || -L "$destination" ]]; then',
  '        if [[ -L "$member" ]]; then source_type=symlink; elif [[ -d "$member" ]]; then source_type=directory; else source_type=file; fi',
  '        if [[ -L "$destination" ]]; then target_type=symlink; elif [[ -d "$destination" ]]; then target_type=directory; elif [[ -f "$destination" ]]; then target_type=file; else target_type=other; fi',
  '        printf "%s\\0%s\\0%s\\0%s\\0" "$member" "$destination" "$source_type" "$target_type"',
  '      fi',
  '    done < "$members"',
  '  elif [[ -e "$root" || -L "$root" ]]; then',
  '    if [[ -d "$source" ]]; then source_type=directory; else source_type=file; fi',
  '    if [[ -L "$root" ]]; then target_type=symlink; elif [[ -d "$root" ]]; then target_type=directory; elif [[ -f "$root" ]]; then target_type=file; else target_type=other; fi',
  '    printf "%s\\0%s\\0%s\\0%s\\0" "$source" "$root" "$source_type" "$target_type"',
  '  fi',
  'done',
].join('\n')

function archivePreflightScript(format: RemoteArchiveFormat): string {
  return [
    'set -euo pipefail',
    'target=$1; archive=$2; output=$3; shift 3',
    '[[ -d "$target" && ! -L "$target" ]] || { printf "%s\\n" "解压目标不是普通文件夹" >&2; exit 1; }',
    '[[ -f "$archive" && ! -L "$archive" ]] || { printf "%s\\n" "压缩包不是普通文件" >&2; exit 1; }',
    'missing=0',
    'for tool in "$@"; do if ! command -v "$tool" >/dev/null; then printf "D\\0%s\\0" "$tool"; missing=1; fi; done',
    '((missing == 0)) || exit 0',
    'if [[ -e "$output" || -L "$output" ]]; then',
    '  if [[ -L "$output" ]]; then output_type=symlink; elif [[ -d "$output" ]]; then output_type=directory; elif [[ -f "$output" ]]; then output_type=file; else output_type=other; fi',
    '  if [[ "$output_type" != directory ]]; then printf "C\\0%s\\0%s\\0directory\\0%s\\0" "$archive" "$output" "$output_type"; exit 0; fi',
    'fi',
    'stage=$(mktemp -d "${TMPDIR:-/tmp}/linux-nexus-preflight.XXXXXX")',
    'payload=$stage/payload; mkdir -- "$payload"',
    'trap \'rm -rf -- "$stage"\' EXIT',
    'trap \'exit 129\' HUP',
    'trap \'exit 130\' INT',
    'trap \'exit 143\' TERM',
    archiveUnpackCommand(format),
    'chmod -R u+rwX,go-rwx -- "$payload"',
    'unsupported=$(find -- "$payload" -mindepth 1 ! \\( -type f -o -type d \\) -print -quit)',
    'if [[ -n "$unsupported" ]]; then printf "%s\\n" "解压内容包含符号链接或特殊文件" >&2; exit 1; fi',
    'members=$stage/members; find -- "$payload" -mindepth 1 -print0 > "$members"',
    'while IFS= read -r -d "" member; do',
    '  relative=${member#"$payload"/}; destination="$output/$relative"',
    '  if [[ -e "$destination" || -L "$destination" ]]; then',
    '    if [[ -d "$member" ]]; then source_type=directory; else source_type=file; fi',
    '    if [[ -L "$destination" ]]; then target_type=symlink; elif [[ -d "$destination" ]]; then target_type=directory; elif [[ -f "$destination" ]]; then target_type=file; else target_type=other; fi',
    '    printf "C\\0%s!/%s\\0%s\\0%s\\0%s\\0" "$archive" "$relative" "$destination" "$source_type" "$target_type"',
    '  fi',
    'done < "$members"',
  ].filter(Boolean).join('\n')
}

function parseConflicts(output: Buffer): OperationConflict[] {
  const fields = output.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 4 !== 0) throw new Error('服务器返回的冲突清单格式无效')
  const conflicts: OperationConflict[] = []
  for (let index = 0; index < fields.length; index += 4) {
    const [sourcePath, targetPath, sourceType, targetType] = fields.slice(index, index + 4)
    if ((sourceType !== 'file' && sourceType !== 'directory')
      || !['file', 'directory', 'symlink', 'other'].includes(targetType)) throw new Error('服务器返回了无效的冲突类型')
    conflicts.push({ sourcePath, targetPath, sourceType, targetType: targetType as OperationConflict['targetType'] })
  }
  return conflicts
}

function rejectUnsupportedTargets(conflicts: OperationConflict[]): void {
  const unsupported = conflicts.find((conflict) => conflict.targetType === 'symlink' || conflict.targetType === 'other')
  if (unsupported) throw new Error('目标包含符号链接或特殊文件，不能参与文件操作：' + unsupported.targetPath)
  const typeMismatch = conflicts.find((conflict) => conflict.sourceType !== conflict.targetType)
  if (typeMismatch) throw new Error('来源与目标类型不一致，不能按原生命令安全覆盖：' + typeMismatch.targetPath)
}

function parseArchivePreflight(output: Buffer): { conflicts: OperationConflict[]; missingDependencies: ArchiveDependency[] } {
  const fields = output.toString('utf8').split('\0')
  if (fields.at(-1) === '') fields.pop()
  const conflicts: OperationConflict[] = []
  const missingDependencies: ArchiveDependency[] = []
  for (let index = 0; index < fields.length;) {
    const marker = fields[index++]
    if (marker === 'D') {
      const dependency = fields[index++]
      if (!['unzip', 'gzip', 'bzip2', 'xz', 'zstd'].includes(dependency)) throw new Error('服务器返回了未知归档依赖')
      missingDependencies.push(dependency as ArchiveDependency)
    } else if (marker === 'C') {
      const [sourcePath, targetPath, sourceType, targetType] = fields.slice(index, index + 4)
      index += 4
      if ((sourceType !== 'file' && sourceType !== 'directory')
        || !['file', 'directory', 'symlink', 'other'].includes(targetType)) throw new Error('服务器返回了无效的归档冲突')
      conflicts.push({ sourcePath, targetPath, sourceType, targetType: targetType as OperationConflict['targetType'] })
    } else throw new Error('服务器返回的归档预检格式无效')
  }
  return { conflicts, missingDependencies }
}

function prunePreflights(): void {
  const now = Date.now()
  for (const [id, preflight] of preflights) if (preflight.expiresAt <= now) preflights.delete(id)
}

export async function preflightRemoteOperation(value: OperationPreflightRequest): Promise<OperationPreflight> {
  const request = validateRequest(value)
  const session = filesSession(request.sessionId)
  prunePreflights()
  let conflicts: OperationConflict[]
  let missingDependencies: ArchiveDependency[] = []
  let archivePath: string | undefined
  let outputDirectory: string | undefined
  if (request.operation === 'extract') {
    archivePath = request.archivePath!
    const format = archiveFormatForName(archivePath)
    if (!format) throw new Error('不支持的压缩包格式')
    outputDirectory = request.wrapInDirectory ? posix.join(request.targetDirectory, archiveBaseName(posix.basename(archivePath))) : request.targetDirectory
    const dependencies = requiredArchiveDependencies(archivePath)
    const { stdout } = await runRemoteCommand(session.client, archivePreflightScript(format),
      [request.targetDirectory, archivePath, outputDirectory, ...dependencies])
    const parsed = parseArchivePreflight(stdout)
    conflicts = parsed.conflicts
    missingDependencies = parsed.missingDependencies
  } else {
    const { stdout } = await runRemoteCommand(session.client, preflightScript, [request.targetDirectory, ...request.sourcePaths])
    conflicts = parseConflicts(stdout)
  }
  rejectUnsupportedTargets(conflicts)
  const previewBase: Pick<OperationPreflight, 'operation' | 'sourcePaths' | 'targetDirectory' | 'archivePath' | 'outputDirectory'> = {
    operation: request.operation,
    sourcePaths: request.sourcePaths,
    targetDirectory: request.targetDirectory,
    ...(archivePath ? { archivePath } : {}),
    ...(outputDirectory ? { outputDirectory } : {}),
  }
  const preflight: StoredPreflight = {
    preflightId: randomUUID(),
    sessionId: request.sessionId,
    operation: request.operation,
    sourcePaths: request.sourcePaths,
    targetDirectory: request.targetDirectory,
    strategy: request.strategy,
    conflicts,
    commandPreviews: {
      force: commandPreview(previewBase, 'force'),
      skip: commandPreview(previewBase, 'skip'),
      update: commandPreview(previewBase, 'update'),
    },
    ...(archivePath ? { archivePath } : {}),
    ...(outputDirectory ? { outputDirectory } : {}),
    ...(missingDependencies.length ? { missingDependencies } : {}),
    expiresAt: Date.now() + PREFLIGHT_TTL_MS,
  }
  preflights.set(preflight.preflightId, preflight)
  const { expiresAt: _expiresAt, ...result } = preflight
  return result
}

export function executeRemoteOperation(request: OperationExecutionRequest): Promise<OperationExecutionResult> {
  if (!request || typeof request.preflightId !== 'string' || !request.preflightId
    || !['force', 'skip', 'update'].includes(request.strategy)) throw new Error('远端操作执行参数无效')
  const preflight = preflights.get(request.preflightId)
  if (!preflight || preflight.expiresAt <= Date.now()) {
    preflights.delete(request.preflightId)
    throw new Error('预检结果已过期，请重新操作')
  }
  if (preflight.missingDependencies?.length) throw new Error('需要先安装缺少的服务器归档工具')
  if (preflight.strategy !== 'confirm' && preflight.strategy !== request.strategy) throw new Error('执行策略与预检策略不一致')
  preflights.delete(request.preflightId)
  const session = filesSession(preflight.sessionId)
  const parts = operationCommandParts(preflight.operation, preflight.sourcePaths, preflight.targetDirectory,
    request.strategy, preflight.archivePath, preflight.outputDirectory)
  const command = buildRemoteCommand(parts.script, parts.args)
  const controller = new AbortController()
  const promise = executeRemoteCommand(session.client, command, { signal: controller.signal, collectStdout: false })
    .then((): OperationExecutionResult => ({ status: 'completed', operation: preflight.operation, command }))
    .catch((error: unknown) => {
      if (controller.signal.aborted) return { status: 'cancelled' as const, operation: preflight.operation, command }
      throw error
    })
    .finally(() => activeOperations.delete(request.preflightId))
  activeOperations.set(request.preflightId, { sessionId: session.sessionId, controller, promise })
  return promise
}

export function cancelRemoteOperation(preflightId: string): boolean {
  const operation = activeOperations.get(preflightId)
  if (!operation) return false
  operation.controller.abort()
  return true
}

export async function installArchiveDependencies(
  sessionId: string,
  dependencies: ArchiveDependency[],
  password: string,
): Promise<void> {
  if (!Array.isArray(dependencies) || dependencies.length === 0
    || dependencies.some((dependency) => !['unzip', 'gzip', 'bzip2', 'xz', 'zstd'].includes(dependency))
    || typeof password !== 'string' || !password || password.includes('\n') || password.includes('\r') || password.includes('\0')) {
    throw new Error('归档依赖安装参数无效')
  }
  const session = filesSession(sessionId)
  const script = [
    'set -eu',
    'IFS= read -r sudo_password',
    'packages=()',
    'for tool in "$@"; do',
    '  case "$tool" in',
    '    unzip) packages+=(unzip) ;;',
    '    gzip) packages+=(gzip) ;;',
    '    bzip2) packages+=(bzip2) ;;',
    '    xz) packages+=(xz-utils) ;;',
    '    zstd) packages+=(zstd) ;;',
    '  esac',
    'done',
    'if command -v apt-get >/dev/null; then manager=apt-get; else',
    '  if command -v dnf >/dev/null; then manager=dnf; elif command -v yum >/dev/null; then manager=yum; else printf "%s\\n" "未找到 apt、dnf 或 yum 包管理器" >&2; exit 1; fi',
    '  for index in "${!packages[@]}"; do [[ "${packages[$index]}" != xz-utils ]] || packages[$index]=xz; done',
    'fi',
    'printf "%s\\n" "$sudo_password" | sudo -S -p "" -- "$manager" install -y -- "${packages[@]}"',
  ].join('\n')
  await runRemoteCommand(session.client, script, dependencies, {
    stdin: Readable.from([Buffer.from(password + '\n')]),
    collectStdout: false,
  })
}

export async function cancelRemoteOperationsForSession(sessionId: string): Promise<void[]> {
  const operations = [...activeOperations.entries()].filter(([, operation]) => operation.sessionId === sessionId)
  for (const [id, operation] of operations) {
    operation.controller.abort()
    preflights.delete(id)
  }
  return Promise.all(operations.map(([, operation]) => operation.promise.then(() => undefined, () => undefined)))
}
