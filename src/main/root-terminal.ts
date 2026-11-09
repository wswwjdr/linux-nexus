import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import type { Client, ClientChannel, PseudoTtyOptions } from 'ssh2'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { buildRemoteCommand } from './ssh-commands'

export type RootTerminalResult = { shell: ClientChannel; output: Buffer } | { error: unknown }

export function openSudoTerminal(
  client: Client,
  pty: PseudoTtyOptions,
  path: string,
  password: Buffer | undefined,
  signal: AbortSignal,
  done: (result: RootTerminalResult) => void,
): void {
  const id = randomUUID()
  const prompt = 'LINUX_NEXUS_SUDO_' + id + ':'
  const ready = 'LINUX_NEXUS_ROOT_' + id + ':'
  const rootShell = [
    '[[ $EUID == 0 ]] || exit 1',
    'stty "$1" || exit 1',
    'cd -- "$2" || exit 1',
    'printf "%s" "$3"',
    'exec /bin/bash -il',
  ].join('\n')
  // Preserve the credential bytes and keep them off the terminal output until sudo authenticates.
  const launch = [
    'terminal_modes=$(stty -g) || exit 1',
    'stty raw -echo -iexten || exit 1',
    'exec /usr/bin/sudo -H -S -p "$1" -u root -- /bin/bash -p -c "$2" -- "$terminal_modes" "$3" "$4"',
  ].join('\n')
  const command = buildRemoteCommand(launch, [prompt, rootShell, posix.resolve('/', path), ready])

  let shell: ClientChannel | undefined
  let settled = false
  let sentPassword = false
  let startup = Buffer.alloc(0)
  const finish = (result: RootTerminalResult) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    shell?.removeListener('data', onData)
    shell?.removeListener('error', onError)
    shell?.removeListener('close', onClose)
    shell?.stderr.removeListener('data', onData)
    shell?.stderr.removeListener('error', onError)
    if ('error' in result) shell?.close()
    done(result)
  }
  const onError = (error: unknown) => finish({ error })
  const onAbort = () => onError(new LocalizedError(msg('errors.rootFileSessionRequiredForTerminal')))
  const onClose = () => onError(new LocalizedError(startup.toString('utf8').trim() || msg('errors.cannotStartRootTerminal')))
  const onData = (chunk: Buffer) => {
    startup = Buffer.concat([startup, chunk])
    const readyAt = startup.indexOf(ready)
    if (readyAt !== -1) {
      finish({ shell: shell!, output: startup.subarray(readyAt + ready.length) })
      return
    }
    if (startup.includes(prompt)) {
      if (!password) {
        onError(new LocalizedError(msg('errors.serverRequiresASudoPassword')))
      } else if (sentPassword) {
        onError(new LocalizedError(msg('errors.incorrectSudoPasswordOrServerRequiresMultiStepAuthentication')))
      } else {
        sentPassword = true
        startup = Buffer.alloc(0)
        try { shell!.write(password) } catch (error) { onError(error) }
      }
    } else if (startup.length > 8192) {
      onError(new LocalizedError(msg('errors.cannotStartRootTerminal')))
    }
  }

  const timer = setTimeout(() => onError(new LocalizedError(msg('errors.sudoAuthenticationTimedOutCheckTheServerAuthenticationPolicy'))), 15_000)
  if (signal.aborted) { onAbort(); return }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    client.exec(command, { pty }, (error, channel) => {
      if (error) { onError(error); return }
      if (settled) { channel.close(); return }
      shell = channel
      channel.once('error', onError)
      channel.once('close', onClose)
      channel.stderr.on('data', onData)
      channel.stderr.once('error', onError)
      channel.on('data', onData)
    })
  } catch (error) {
    onError(error)
  }
}
