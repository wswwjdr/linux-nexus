import type { TextFileVersion, TextSaveResult } from '@shared/types'
import { LocalizedError, msg } from '../shared/i18n/messages'
import { receiveStagedFile } from './staged-write'
import { fileCapabilities, requireCapabilities } from './server-capabilities'
import { runRemoteCommand, RemoteCommandError, type RemoteCommandTarget, type RemoteCommandOptions } from './ssh-commands'

export const versionedWriteCapabilities = fileCapabilities['text-save']
export const fileHashPattern = /^[a-f0-9]{64}$/
const targetChangedMarker = 'LINUX_NEXUS_DIAGNOSTIC:versionedTargetChanged'

/** Builds a remote regular-file check for a fixed shell variable or positional parameter.
 * @param pathVariable Shell reference containing the remote path.
 * @returns Server-side check and a diagnostic for an unsupported or disappeared path.
 */
export function regularFileGuard(pathVariable: '$destination' | '$1'): string {
  return `[[ -f "${pathVariable}" && ! -L "${pathVariable}" ]] || { printf '%s\\n' '${targetChangedMarker}' >&2; exit 75; }`
}

/** Returns whether the remote command found a missing or changed target.
 * @param error Error from the target version check.
 * @returns Whether the error describes a target change.
 */
export function versionedTargetChanged(error: unknown): boolean {
  return error instanceof RemoteCommandError && (error.exitCode === 75 && error.stderr.trim() === targetChangedMarker
    || error.stderr.trim() === 'LINUX_NEXUS_DIAGNOSTIC:readChanged')
}

/** Returns the remote save script, which reports saved and conflict outcomes on stdout. */
export function buildVersionedWriteCommand(): string {
  return `set -euo pipefail
destination=$1
expected_hash=$2
expected_identity=$3
check_destination() {
  ${regularFileGuard('$destination')}
  [[ $(stat -c %h -- "$destination") == 1 ]] || { printf "%s\\n" "LINUX_NEXUS_DIAGNOSTIC:hardlinkType" >&2; exit 1; }
}
${requireCapabilities(versionedWriteCapabilities)}
check_destination
metadata() {
  stat -c '%u:%g:%a' -- "$1" || return
  getfacl -cn -- "$1" || return
  getfattr --absolute-names -d -m - -e hex -- "$1" | sed '/^#/d'
}
directory=$(dirname -- "$destination")
name=$(basename -- "$destination")
temporary=$(mktemp -- "$directory/.$name.edit.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
${receiveStagedFile('$4')}
check_destination
current_identity=$(stat -c '%d:%i:%s:%y:%z' -- "$destination")
original_metadata=$(metadata "$destination")
cp --attributes-only --preserve=all -- "$destination" "$temporary"
touch -m -- "$temporary"
copied_metadata=$(metadata "$temporary")
[[ $copied_metadata == "$original_metadata" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:preserveMetadata' >&2; exit 1; }
current_hash=$(sha256sum < "$destination")
current_hash=\${current_hash%% *}
[[ $(stat -c '%d:%i:%s:%y:%z' -- "$destination") == "$current_identity" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:readChanged' >&2; exit 1; }
if [[ $current_hash != "$expected_hash" || $current_identity != "$expected_identity" ]]; then
  printf 'conflict\\t%s\\t%s\\n' "$current_hash" "$current_identity"
  exit 0
fi
mv -fT -- "$temporary" "$destination"
trap - EXIT HUP INT TERM
saved_hash=$(sha256sum < "$destination")
saved_identity=$(stat -c '%d:%i:%s:%y:%z' -- "$destination")
printf 'saved\\t%s\\t%s\\n' "\${saved_hash%% *}" "$saved_identity"`
}

/**
 * Validates a version sent by the remote command.
 * @param hash SHA-256 of the file contents.
 * @param identity Remote stat fingerprint.
 * @returns A validated file version.
 */
export function parseFileVersion(hash: string, identity: string): TextFileVersion {
  if (!fileHashPattern.test(hash) || !identity || /[\x00\t\r\n]/.test(identity)) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersion'))
  return { hash, identity }
}

/** Commits validated bytes from a producer against the original remote version.
 * @param commands Active remote command scope.
 * @param path Destination path.
 * @param expected Original remote version.
 * @param size Expected byte count.
 * @param draftHash SHA-256 of the confirmed bytes.
 * @param stdin Bytes followed by the producer's validated commit record.
 * @param options Optional cancellation and command timeout.
 * @returns The saved version or the remote version responsible for a conflict.
 */
export async function writeVersionedFile(
  commands: RemoteCommandTarget, path: string, expected: TextFileVersion, size: number, draftHash: string,
  stdin: NonNullable<RemoteCommandOptions['stdin']>, { signal, timeoutMs }: RemoteCommandOptions = {},
): Promise<TextSaveResult> {
  const { stdout } = await runRemoteCommand(commands, buildVersionedWriteCommand(), [path, expected.hash, expected.identity, String(size)], { stdin, signal, timeoutMs, maxStdoutBytes: 1024 })
  const output = stdout.toString()
  const fields = output.slice(0, -1).split('\t')
  const [status, hash, identity] = fields
  if (!output.endsWith('\n') || fields.length !== 3 || (status !== 'saved' && status !== 'conflict')) {
    throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersionFormat'))
  }
  const version = parseFileVersion(hash, identity)
  if (status === 'saved' && version.hash !== draftHash) throw new LocalizedError(msg('errors.fileChangedAgainAfterSavingReloadItYourDraftHas'))
  return { status, version }
}
