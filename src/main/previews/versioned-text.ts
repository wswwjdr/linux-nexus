import { createHash } from 'node:crypto'
import type { TextFileVersion, TextSaveOptions, TextSaveResult } from '@shared/types'
import { msg, LocalizedError } from '../../shared/i18n/messages'
import { DependencyRequiredError } from '../../shared/dependency-error'
import { commitRecord, receiveStagedFile } from '../staged-write'
import { filesSession, normalizedRemotePath } from '../remote-fs'
import { runRemoteCommand, RemoteCommandError } from '../ssh-commands'
import { readPreviewLimits } from '../state-store'
import { fileCapabilities, operationCapabilityReport, requireCapabilities } from '../server-capabilities'
import { offerFileDependencies } from '../file-dependencies'
import { encodeEditedText } from './text-codec'

const textSaveCapabilities = fileCapabilities['text-save']
const hashPattern = /^[a-f0-9]{64}$/
const conflictMarker = 'LINUX_NEXUS_TEXT_CONFLICT:'

/** Returns the remote save script that checks dependencies and the expected version before committing. */
export function buildTextSaveCommand(): string {
  return `set -euo pipefail
destination=$1
expected_hash=$2
expected_identity=$3
${requireCapabilities(textSaveCapabilities)}
[[ -f "$destination" && ! -L "$destination" && $(stat -c %h -- "$destination") == 1 ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:hardlinkType' >&2; exit 1; }
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
[[ -f "$destination" && ! -L "$destination" && $(stat -c %h -- "$destination") == 1 ]] || exit 1
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
  printf '${conflictMarker}%s\\t%s\\n' "$current_hash" "$current_identity" >&2
  exit 73
fi
mv -fT -- "$temporary" "$destination"
trap - EXIT HUP INT TERM
sha256sum < "$destination"
stat -c '%d:%i:%s:%y:%z' -- "$destination"`
}

/**
 * Validates a version sent by the remote command.
 * @param hash SHA-256 of the file contents.
 * @param identity Remote stat fingerprint.
 * @returns A validated file version.
 */
function parseVersion(hash: string, identity: string): TextFileVersion {
  if (!hashPattern.test(hash) || !identity || /[\x00\t\r\n]/.test(identity)) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersion'))
  return { hash, identity }
}

/**
 * Reads a verified snapshot of a regular remote file without decoding its content.
 * @param client Remote command scope.
 * @param remotePath Absolute path of the source file.
 * @param limitBytes Maximum source file size.
 * @returns Snapshot bytes and their version.
 */
export async function readVersionedTextBytes(client: Parameters<typeof runRemoteCommand>[0], remotePath: string, limitBytes: number) {
  const { stdout } = await runRemoteCommand(client, `set -eu
[[ -f "$1" && ! -L "$1" ]]
before=$(stat -c '%d:%i:%s:%y:%z' -- "$1")
[[ $(stat -c '%s' -- "$1") -le "$2" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:textSizeLimit' >&2; exit 1; }
hash=$(sha256sum < "$1"); hash=\${hash%% *}
printf '%s\\0%s\\0' "$hash" "$before"
cat -- "$1"
[[ $(stat -c '%d:%i:%s:%y:%z' -- "$1") == "$before" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:readChanged' >&2; exit 1; }`, [remotePath, String(limitBytes)], { maxStdoutBytes: limitBytes + 1024 })
  const first = stdout.indexOf(0)
  const second = stdout.indexOf(0, first + 1)
  if (first !== 64 || second < 0) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersionFormat'))
  const version = parseVersion(stdout.subarray(0, first).toString(), stdout.subarray(first + 1, second).toString())
  const buffer = stdout.subarray(second + 1)
  if (buffer.length > limitBytes) throw new LocalizedError(msg('errors.textExceedsThePreviewLimit'))
  if (createHash('sha256').update(buffer).digest('hex') !== version.hash) throw new LocalizedError(msg('errors.fileChangedWhileBeingReadReopenIt'))
  return { bytes: buffer, version }
}

/**
 * Saves a draft in an active file session after verifying metadata tool availability.
 * @param sessionId File session and current remote command identity.
 * @param remotePath Destination on the server.
 * @param content Edited draft.
 * @param lineEnding Requested line ending, validated before writing.
 * @param options Target encoding, BOM and expected version.
 * @returns The committed version or the current version on conflict.
 */
export async function saveTextFile(sessionId: string, remotePath: string, content: string, lineEnding: unknown, options: TextSaveOptions): Promise<TextSaveResult> {
  const { commands } = filesSession(sessionId)
  try {
    return await saveVersionedText(commands, remotePath, content, lineEnding, options)
  } catch (error) {
    const report = operationCapabilityReport(error, textSaveCapabilities)
    if (!report) throw error
    throw new DependencyRequiredError(offerFileDependencies(sessionId, commands, 'text-save', textSaveCapabilities, report))
  }
}

/**
 * Encodes and commits a draft only if the target matches the expected version.
 * @param commands Remote command scope.
 * @param remotePath Destination file.
 * @param content Current text draft.
 * @param lineEnding Requested line ending, validated before writing.
 * @param options Target encoding, BOM and expected version.
 * @returns The saved version or the version that caused a conflict.
 */
async function saveVersionedText(commands: Parameters<typeof runRemoteCommand>[0], remotePath: string,
  content: string, lineEnding: unknown, options: TextSaveOptions): Promise<TextSaveResult> {
  if (typeof content !== 'string' || !options || typeof options !== 'object'
    || !options.version || typeof options.version.hash !== 'string' || !hashPattern.test(options.version.hash)
    || typeof options.version.identity !== 'string' || !options.version.identity || /[\x00\t\r\n]/.test(options.version.identity)
    || (options.encoding !== 'utf8' && options.encoding !== 'gbk') || typeof options.bom !== 'boolean'
    || (lineEnding !== null && lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r')) throw new LocalizedError(msg('errors.invalidTextSaveParameters'))
  const path = normalizedRemotePath(remotePath)
  const bytes = encodeEditedText(content, lineEnding, options.encoding, options.bom)
  if (bytes.length > readPreviewLimits().textMiB * 1024 * 1024) throw new LocalizedError(msg('errors.savedTextExceedsThePreviewLimit'))
  const draftHash = createHash('sha256').update(bytes).digest('hex')
  try {
    const { stdout } = await runRemoteCommand(commands, buildTextSaveCommand(), [path, options.version.hash, options.version.identity, String(bytes.length)], { stdin: [bytes, commitRecord(draftHash)], maxStdoutBytes: 1024 })
    const [hashLine, identity] = stdout.toString().trimEnd().split('\n')
    const version = parseVersion(hashLine.split(' ')[0], identity)
    if (version.hash !== draftHash) throw new LocalizedError(msg('errors.fileChangedAgainAfterSavingReloadItYourDraftHas'))
    return { status: 'saved', version }
  } catch (error) {
    if (error instanceof RemoteCommandError && error.exitCode === 73 && error.stderr.startsWith(conflictMarker)) {
      const [hash, identity] = error.stderr.slice(conflictMarker.length).trimEnd().split('\t')
      return { status: 'conflict', version: parseVersion(hash, identity) }
    }
    throw error
  }
}
