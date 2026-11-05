import type { TextSaveInstallResult, TextSavePackage } from '@shared/types'
import { detectServerDistribution } from '../file-session-capabilities'
import { filesSession } from '../remote-fs'
import { RemoteCommandError, runRemoteCommand } from '../ssh-commands'

const dependencyCommands = { acl: 'getfacl', attr: 'getfattr' } satisfies Record<TextSavePackage, string>
const missingPrefix = 'LINUX_NEXUS_TEXT_DEPENDENCIES:'
const missingExitCode = 74
const sudoPrompt = 'LINUX_NEXUS_SUDO_PASSWORD:'
const activeInstalls = new Set<string>()

function findMissingPackages(packages: string): string {
  return `missing=()
for package in ${packages}; do
  case "$package" in
${Object.entries(dependencyCommands).map(([name, command]) => `    ${name}) tool=${command} ;;`).join('\n')}
  esac
  command -v "$tool" >/dev/null || missing+=("$package")
done`
}

export const requireTextSaveDependencies = `${findMissingPackages(Object.keys(dependencyCommands).join(' '))}
if [[ \${missing[0]+set} ]]; then
  printf '${missingPrefix}%s\\n' "\${missing[*]}" >&2
  exit ${missingExitCode}
fi`

function isTextSavePackage(value: unknown): value is TextSavePackage {
  return typeof value === 'string' && Object.hasOwn(dependencyCommands, value)
}

export function missingTextSavePackages(error: unknown): TextSavePackage[] | undefined {
  if (!(error instanceof RemoteCommandError) || error.exitCode !== missingExitCode || !error.stderr.startsWith(missingPrefix)) return
  const packages = error.stderr.slice(missingPrefix.length).trimEnd().split(' ')
  if (packages.every(isTextSavePackage)) return packages
}

const textSaveInstallScript = `set -euo pipefail
export LC_ALL=C
${findMissingPackages('"$@"')}
if [[ ! \${missing[0]+set} ]]; then exit 0; fi
${detectServerDistribution}
manager=/usr/bin/$package_manager
if [[ ! -x "$manager" ]]; then
  printf '服务器缺少包管理器 %s\\n' "$manager" >&2
  exit 1
fi
if (( EUID == 0 )); then
  exec "$manager" -y install "\${missing[@]}" </dev/null
fi
if ! command -v sudo >/dev/null; then
  printf '%s\\n' '安装需要 root 权限，当前 SSH 会话找不到 sudo' >&2
  exit 1
fi
exec sudo -S -p '${sudoPrompt}' -- "$manager" -y install "\${missing[@]}"`

export async function installTextSaveDependencies(sessionId: string, packages: unknown, password: unknown): Promise<TextSaveInstallResult> {
  const requested = Array.isArray(packages) ? [...new Set(packages)] : []
  if (!requested.length || !requested.every(isTextSavePackage)
    || (password !== undefined && (typeof password !== 'string' || !password || /[\0\r\n]/.test(password)))) {
    throw new Error('远程保存依赖安装参数无效')
  }
  const { commands, profileId } = filesSession(sessionId)
  if (activeInstalls.has(profileId)) throw new Error('此连接正在安装远程保存依赖，请稍后重试')
  activeInstalls.add(profileId)

  let resolvePrompt!: (prompted: boolean) => void
  const prompt = new Promise<boolean>(resolve => { resolvePrompt = resolve })
  async function* passwordInput(password: string) {
    // Send the password only after sudo asks, so a passwordless command receives no secret on stdin.
    if (await prompt) yield Buffer.from(password + '\n')
  }
  let prompted = false
  let stderrTail = ''
  let stdoutTail = ''
  try {
    await runRemoteCommand(commands, textSaveInstallScript, requested, {
      timeoutMs: 5 * 60_000,
      collectStdout: false,
      stdin: password === undefined ? undefined : passwordInput(password),
      onStdout: chunk => { stdoutTail = (stdoutTail + chunk.toString()).slice(-2048) },
      onStderr: chunk => {
        if (prompted) return
        const output = stderrTail + chunk.toString()
        prompted = output.includes(sudoPrompt)
        stderrTail = output.slice(-sudoPrompt.length)
        if (prompted) resolvePrompt(true)
      },
    })
    return { status: 'installed' }
  } catch (error) {
    if (!(error instanceof RemoteCommandError) || error.exitCode === null) throw error
    if (prompted && password === undefined) return { status: 'password-required' }
    const detail = error.stderr.replaceAll(sudoPrompt, '').trim() || stdoutTail.trim() || error.message
    throw new Error(detail)
  } finally {
    resolvePrompt(false)
    activeInstalls.delete(profileId)
  }
}
