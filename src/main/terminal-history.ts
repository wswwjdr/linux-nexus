import { randomUUID } from 'node:crypto'
import type { Client, ClientChannel, PseudoTtyOptions } from 'ssh2'
import { shellQuote } from '../shared/shell'
import { terminalHistoryKey, terminalHistoryOsc } from '../shared/terminal-history'
import { executeRemoteCommand } from './ssh-commands'

/** Detects Bash without requiring that the account already runs it.
 * @param client Authenticated SSH connection to the account.
 * @param signal Cancellation signal for the probe.
 * @returns The absolute Bash login executable, or undefined when the native shell should be used.
 */
async function detectTerminalBash(client: Client, signal: AbortSignal): Promise<string | undefined> {
  try {
    const { stdout } = await executeRemoteCommand(client, 'getent passwd "$(id -un)" | cut -d: -f7', {
      signal, timeoutMs: 2000, maxStdoutBytes: 4096,
    })
    const path = stdout.toString('utf8').trimEnd().split(/\r?\n/).at(-1)
    if (path && path.startsWith('/') && path.endsWith('/bash') && !/[\x00-\x1f\x7f]/.test(path)) return path
  } catch (error) {
    if (!(error instanceof Error)) throw error
    // Capability detection is optional. The native SSH shell still works if it fails.
  }
}

/** Returns an identifier scoped to one interactive PTY for routing its control frames. */
export function newTerminalHistoryToken(): string {
  return randomUUID().replaceAll('-', '')
}

/** Builds the history hooks for the current Bash process.
 * @param token Identifier for the PTY frames and history record boundaries.
 * @returns Bash code to seed PROMPT_COMMAND at login.
 */
export function terminalHistoryPromptCommand(token: string): string {
  const osc = `\\e]${terminalHistoryOsc};${token};`
  const printf = `builtin printf '${osc}%s;%s\\a'`
  const readlineKeys = [...'0123456789', '10', '11'].map(key => {
    const sequence = terminalHistoryKey(key).replace('\x1b', '\\e')
    return `builtin bind -m "$map" -x '\"${sequence}\":__linux_nexus_history_pick ${key}'`
  }).join(' &&\n    ')

  return `__linux_nexus_history_pick() {
  local command
  # The UI sends only an event number. Readline fetches and replaces the buffer without pressing Enter.
  case "$1" in
    10) __linux_nexus_history_number= ;;
    11)
      if [[ \${__linux_nexus_history_number:-} =~ ^[1-9][0-9]*$ ]] &&
        command=$(builtin history -p "!$__linux_nexus_history_number" 2>/dev/null) &&
        [[ -n $command && $command != *[[:cntrl:]]* ]]; then
        READLINE_LINE=$command
        READLINE_POINT=\${#READLINE_LINE}
      fi
      __linux_nexus_history_number=
      ;;
    *)
      if (( \${#__linux_nexus_history_number} < 16 )); then
        __linux_nexus_history_number+=$1
      else
        __linux_nexus_history_number=
      fi
      ;;
  esac
}
__linux_nexus_history_init() {
  local map
  export -n PROMPT_COMMAND
  command -v base64 >/dev/null || return 1
  for map in emacs-standard vi-insert; do
    ${readlineKeys} || return 1
  done
}
__linux_nexus_history_prompt() {
  local status=$? snapshot='' chunk
  __linux_nexus_history_number=
  if [[ \${PS1:-} != *'${osc}input'* ]]; then PS1+='\\[${osc}input\\a\\]'; fi
  if [[ \${PS0:-} != *'${osc}busy'* ]]; then PS0='${osc}busy\\a'\${PS0:-}; fi
  if [[ \${PS2:-} != *'${osc}busy'* ]]; then PS2='\\[${osc}busy\\a\\]'\${PS2:-}; fi
  if [[ -o history ]]; then
    # The sentinel survives command substitution and preserves history's final record boundary.
    snapshot=$(HISTTIMEFORMAT=$'\\001${token}\\002' builtin history; builtin printf '.')
  fi
  if [[ \${__linux_nexus_history_snapshot+x} != x || $snapshot != "$__linux_nexus_history_snapshot" ]]; then
    ${printf} begin ''
    if [[ -n $snapshot ]]; then
      builtin printf '%s' "\${snapshot%.}" | command base64 | while IFS= read -r -N 4096 chunk || [[ -n $chunk ]]; do
        ${printf} chunk "\${chunk//$'\\n'/}"
      done
    fi
    ${printf} end ''
    __linux_nexus_history_snapshot=$snapshot
  fi
  ${printf} prompt ''
  return "$status"
}
if __linux_nexus_history_init; then
  PROMPT_COMMAND=__linux_nexus_history_prompt
  __linux_nexus_history_prompt
else
  unset PROMPT_COMMAND
fi`
}

/** Builds an interactive Bash login command seeded with the history hooks.
 * @param path Absolute path of the verified Bash executable.
 * @param token Identifier scoped to this PTY.
 * @returns A quoted command suitable for the remote launcher shell.
 */
export function terminalBashLaunch(path: string, token: string): string {
  return `PROMPT_COMMAND=${shellQuote(terminalHistoryPromptCommand(token))} exec ${shellQuote(path)} -il`
}

/** Opens a PTY with optional Bash history support.
 * @param client Authenticated SSH connection to the account.
 * @param pty Terminal type and starting dimensions.
 * @param signal Connection-attempt cancellation signal.
 * @returns The interactive channel and the history token if Bash integration was requested.
 */
export async function openTerminalShell(
  client: Client, pty: PseudoTtyOptions, signal: AbortSignal,
): Promise<{ shell: ClientChannel; historyToken?: string }> {
  const bash = await detectTerminalBash(client, signal)
  signal.throwIfAborted()
  if (bash) {
    const historyToken = newTerminalHistoryToken()
    const shell = await new Promise<ClientChannel | undefined>(resolve => {
      client.exec(terminalBashLaunch(bash, historyToken), { pty }, (error, channel) => resolve(error ? undefined : channel))
    })
    if (signal.aborted) shell?.close()
    signal.throwIfAborted()
    if (shell) return { shell, historyToken }
  }
  const shell = await new Promise<ClientChannel>((resolve, reject) => {
    client.shell(pty, (error, channel) => error ? reject(error) : resolve(channel))
  })
  if (signal.aborted) shell.close()
  signal.throwIfAborted()
  return { shell }
}
