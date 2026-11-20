import type { RemoteArchiveFormat } from '../shared/archive.ts'
import { LocalizedError, msg } from '../shared/i18n/messages.ts'
import { shellQuote } from '../shared/shell.ts'
import { executeRemoteCommand, RemoteCommandError, runRemoteCommand, type RemoteCommandTarget } from './ssh-commands.ts'
import { rangeReadOptions } from './remote-byte-reader.ts'

const coreutils = ['cat', 'cp', 'mv', 'rm', 'mkdir', 'rmdir', 'sha256sum', 'mktemp',
  'stat', 'touch', 'readlink', 'du', 'base64', 'dirname', 'basename'] as const

const probes = {
  bash: "bash --noprofile --norc -c 'set -euo pipefail; values=(ok); [[ ${values[0]} == ok ]]'",
  cp: 'cp --attributes-only --preserve=all --version',
  mv: 'mv -nT --version',
  find: '[ "$(find -P -- /dev/null -mindepth 0 -maxdepth 0 -printf %f)" = null ]',
  grep: "printf 'one\\ntwo\\n' | grep -aFHn -C 1 -Z --no-group-separator -- two",
  tar: 'tar --overwrite --no-same-owner --no-same-permissions --version && tar --skip-old-files --version && tar --keep-newer-files --version',
  dd: `[ "$(printf 012345 | command dd ${rangeReadOptions} skip=2 count=3 status=none)" = 234 ]`,
  head: '[ "$(printf 012345 | command head -c 3)" = 012 ]',
  readlink: 'readlink --canonicalize-existing --zero -- /dev/null',
  stat: "stat -c '%d:%i:%s:%y:%z' -- /dev/null",
  du: 'du --block-size=1 --summarize -- /dev/null',
  base64: "printf x | base64 -w0",
  getfacl: 'getfacl -cn -- /dev/null',
  getfattr: 'getfattr --absolute-names -d -m - -e hex -- /dev/null',
  unzip: 'unzip -v',
  gzip: 'gzip --version',
  bzip2: 'bzip2 --help',
  xz: 'xz --version',
  zstd: 'zstd --version',
} as const

export type Capability = typeof coreutils[number] | keyof typeof probes | 'awk' | 'sed'
export const baseCapabilities: readonly Capability[] = ['bash', 'find']
export const fileCapabilities = {
  'media-preview': ['stat', 'dd'],
  'log-preview': ['stat', 'dd'],
  'image-preview': ['cat', 'stat'],
  'text-preview': ['cat', 'stat', 'sha256sum'],
  'markdown-preview': ['cat', 'stat', 'sha256sum', 'head'],
  download: ['head', 'stat'],
  upload: ['dirname', 'basename', 'mkdir', 'rm', 'rmdir', 'head', 'stat', 'sha256sum', 'cp', 'touch', 'mv'],
  'text-save': ['getfacl', 'getfattr', 'stat', 'dirname', 'basename', 'mktemp', 'rm', 'head', 'sha256sum', 'cp', 'touch', 'mv', 'sed'],
  'content-search': ['grep', 'base64'],
  properties: ['stat', 'readlink'],
  'directory-stats': ['du', 'awk'],
  'create-directory': ['mkdir'],
  rename: ['mv'],
  'resolve-link': ['readlink'],
  delete: ['rm'],
  copy: ['cp', 'mkdir'],
  move: ['mv'],
} as const satisfies Record<string, readonly Capability[]>
export type FileCapabilityPurpose = keyof typeof fileCapabilities
export const archiveCapabilities: Record<RemoteArchiveFormat, readonly Capability[]> = {
  zip: ['unzip', 'mkdir'], tar: ['tar', 'mkdir'], 'tar-gz': ['tar', 'gzip', 'mkdir'],
  'tar-bz2': ['tar', 'bzip2', 'mkdir'], 'tar-xz': ['tar', 'xz', 'mkdir'], 'tar-zst': ['tar', 'zstd', 'mkdir'],
}
export const archiveSetupCapabilities = [...new Set(Object.values(archiveCapabilities).flat())]
export interface CapabilityReport { missing: Capability[]; incompatible: Capability[] }
export interface Distribution { id?: string; like: string[]; version?: string }
export type Manager = 'apt-get' | 'dnf' | 'yum'
export interface ServerEnvironment {
  distribution: Distribution
  effectiveUid: number
  managers: Manager[]
  canSudo: boolean
  base: CapabilityReport
}

const gnuNames = new Map<Capability, string>([
  ...coreutils.map(tool => [tool, 'GNU coreutils'] as const),
  ['grep', 'GNU grep'], ['tar', 'GNU tar'],
])
const diagnostic = 'LINUX_NEXUS_CAPABILITY:'

/**
 * Builds a POSIX script that checks for missing and incompatible server tools.
 * @param required App-defined capabilities to check on the server.
 * @returns A shell script that writes capability diagnostics to stdout.
 */
export function capabilityProbe(required: readonly Capability[]): string {
  return required.map(tool => {
    const version = gnuNames.get(tool)
    const probe = Object.hasOwn(probes, tool) ? probes[tool as keyof typeof probes] : undefined
    return [
      `if ! command -v ${tool} >/dev/null 2>&1; then`,
      `  printf '%s\\n' '${diagnostic}missing:${tool}'`,
      // Bash 5.1 needs the opening parentheses when this case is inside $(...).
      ...(version ? [`elif ! case "$(${tool} --version 2>/dev/null)" in (*'${version}'*) true ;; (*) false ;; esac; then`,
        `  printf '%s\\n' '${diagnostic}incompatible:${tool}'`] : []),
      ...(probe ? [`elif ! ( ${probe} ) </dev/null >/dev/null 2>&1; then`,
        `  printf '%s\\n' '${diagnostic}incompatible:${tool}'`] : []),
      'fi',
    ].join('\n')
  }).join('\n')
}

/** Returns the report parsed from remote `output`, validating each diagnostic against `required`. */
function parseReport(output: string, required: readonly Capability[]): CapabilityReport {
  const report: CapabilityReport = { missing: [], incompatible: [] }
  const allowed = new Set<string>(required)
  for (const line of output.split('\n').filter(Boolean)) {
    const match = /^LINUX_NEXUS_CAPABILITY:(missing|incompatible):([a-z0-9]+)$/.exec(line)
    if (!match || !allowed.delete(match[2])) throw new LocalizedError(msg('errors.invalidCapabilityReport'))
    report[match[1] as keyof CapabilityReport].push(match[2] as Capability)
  }
  return report
}

/** Returns a preflight script that stops the operation if any capability in `required` fails. */
export function requireCapabilities(required: readonly Capability[]): string {
  if (!required.length) return ':'
  return `dependency_report=$(export LC_ALL=C;\n${capabilityProbe(required)}\n)
if [ -n "$dependency_report" ]; then
  printf '%s\\n' "$dependency_report" >&2
  exit 74
fi`
}

/** Returns the preflight report for `required` if the command `error` carries one. */
export function operationCapabilityReport(error: unknown, required: readonly Capability[]): CapabilityReport | undefined {
  if (error instanceof RemoteCommandError && error.exitCode === 74 && error.stderr.startsWith(diagnostic)) {
    return parseReport(error.stderr, required)
  }
}

/**
 * Probes the commands in `required` under the identity supplied by `target`.
 * @param target SSH client or file command scope.
 * @param required Capabilities needed by the operation.
 * @param signal Optional cancellation signal for this probe.
 * @returns Missing and incompatible tools.
 */
export async function checkCapabilities(target: RemoteCommandTarget, required: readonly Capability[], signal?: AbortSignal): Promise<CapabilityReport> {
  if (!required.length) return { missing: [], incompatible: [] }
  const { stdout } = await runRemoteCommand(target, `export LC_ALL=C\n${capabilityProbe(required)}`, [], {
    maxStdoutBytes: 4096, signal,
  })
  return parseReport(stdout.toString(), required)
}

/** Returns an SSH command to execute `script` via POSIX sh with safely quoted positional `args`. */
export function posixCommand(script: string, args: readonly string[] = []): string {
  return ['/bin/sh', '-c', shellQuote(script), '--', ...args.map(shellQuote)].join(' ')
}

/** Returns the recognized distribution fields from raw os-release `data`, treating it as plain text. */
export function parseDistribution(data: string): Distribution {
  const fields = new Map<string, string>()
  const seen = new Set<string>()
  for (const line of data.split(/\r?\n/)) {
    const key = /^(ID|ID_LIKE|VERSION_ID)=/.exec(line)?.[1]
    if (!key) continue
    const match = /=(?:"([a-zA-Z0-9._ -]+)"|'([a-zA-Z0-9._ -]+)'|([a-zA-Z0-9._-]+))$/.exec(line.slice(key.length))
    if (seen.has(key)) fields.delete(key)
    else if (match?.index === 0) fields.set(key, match[1] ?? match[2] ?? match[3])
    seen.add(key)
  }
  const validId = /^[a-z0-9._-]+$/
  const id = fields.get('ID')
  return { id: id && validId.test(id) ? id : undefined, like: (fields.get('ID_LIKE') ?? '').split(/ +/).filter(value => validId.test(value)), version: fields.get('VERSION_ID') }
}

/** Builds the connection probe using POSIX shell builtins even when coreutils and Bash are missing. */
export function buildEnvironmentProbe(): string {
  return `set -eu
export LC_ALL=C
kernel=
if [ -r /proc/sys/kernel/ostype ]; then IFS= read -r kernel < /proc/sys/kernel/ostype || :; fi
if [ -z "$kernel" ]; then kernel=$(uname -s); fi
[ "$kernel" = Linux ]
uid=
if [ -r /proc/self/status ]; then
  while read -r field real effective rest; do
    if [ "$field" = Uid: ]; then uid=$effective; break; fi
  done < /proc/self/status
fi
if [ -z "$uid" ]; then uid=$(id -u); fi
printf '%s\\0' "$uid"
for manager in apt-get dnf yum; do
  if [ -x "/usr/bin/$manager" ] && "/usr/bin/$manager" --version </dev/null >/dev/null 2>&1; then printf '%s ' "$manager"; fi
done
if [ -x /usr/bin/sudo ]; then printf '%s ' sudo; fi
printf '\\0'
${capabilityProbe(baseCapabilities)}
printf '\\0'
if [ -r /etc/os-release ]; then release=/etc/os-release
elif [ -r /usr/lib/os-release ]; then release=/usr/lib/os-release
else exit 0; fi
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ID=*|ID_LIKE=*|VERSION_ID=*) printf '%s\\n' "$line";; esac
done < "$release"`
}

/** Returns the validated Linux environment from `target`, optionally cancelling with `signal`. */
export async function inspectServer(target: RemoteCommandTarget, signal?: AbortSignal): Promise<ServerEnvironment> {
  let output: string
  try {
    const { stdout } = await executeRemoteCommand(target, posixCommand(buildEnvironmentProbe()), { maxStdoutBytes: 16_384, signal })
    output = stdout.toString()
  } catch (error) {
    if (!(error instanceof RemoteCommandError) || error.exitCode === null) throw error
    throw new LocalizedError(msg('errors.cannotProbeLinuxEnvironment', { detail: error.stderr.trim() || String(error.exitCode) }))
  }
  const [uid, toolNames, report, ...release] = output.split('\0')
  if (!/^\d+$/.test(uid) || !Number.isSafeInteger(Number(uid)) || !release.length
    || !/^(?:apt-get |dnf |yum |sudo )*$/.test(toolNames)) throw new LocalizedError(msg('errors.invalidCapabilityReport'))
  const tools = toolNames.trim().split(' ')
  return {
    distribution: parseDistribution(release.join('\0')), effectiveUid: Number(uid), canSudo: tools.includes('sudo'),
    managers: tools.filter((tool): tool is Manager => tool === 'apt-get' || tool === 'dnf' || tool === 'yum'),
    base: parseReport(report, baseCapabilities),
  }
}

/** Returns whether `report` contains no missing or incompatible tools. */
export function capabilitiesReady(report: CapabilityReport): boolean {
  return report.missing.length === 0 && report.incompatible.length === 0
}
