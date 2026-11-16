import { msg, LocalizedError } from '../../../shared/i18n/messages'
import { createHash, randomUUID } from 'node:crypto'
import { registerMarkdownResources } from '../preview-assets'
import { commitRecord, receiveStagedFile } from '../../staged-write'
import iconv from 'iconv-lite'
import type { PreviewResult, TextLineEnding, TextEncoding, TextFileVersion, TextSaveOptions, TextSaveResult } from '@shared/types'
import { filesSession, normalizedRemotePath } from '../../remote-fs'
import { runRemoteCommand, RemoteCommandError } from '../../ssh-commands'
import { readPreviewLimits } from '../../state-store'
import { type PreviewStrategy } from '../preview-strategy'
import { fileCapabilities, operationCapabilityReport, requireCapabilities } from '../../server-capabilities'
import { offerFileDependencies } from '../../file-dependencies'
import { DependencyRequiredError } from '../../../shared/dependency-error'

const textSaveCapabilities = fileCapabilities['text-save']

type TextPreviewResult = Extract<PreviewResult, { type: 'text' | 'markdown' }>
const hashPattern = /^[a-f0-9]{64}$/

export function decodeText(buffer: Buffer, selected?: TextEncoding): { content: string; encoding: TextEncoding; bom: boolean } {
  const bom = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
  const bytes = bom ? buffer.subarray(3) : buffer
  let encoding: TextEncoding = selected ?? 'utf8'
  if (!selected && !bom) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { encoding = 'gbk' }
  }
  if (bom && encoding !== 'utf8') throw new LocalizedError(msg('errors.utf8BomDoesNotMatchTheSelectedEncoding'))
  const content = encoding === 'utf8'
    ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    : iconv.decode(bytes, 'gbk')
  if (!iconv.encode(content, encoding).equals(bytes)) throw new LocalizedError(msg('errors.cannotReadTheFileLosslesslyWithThisEncodingDownloadIt'))
  return { content, encoding, bom }
}

function detectTextLineEnding(content: string): TextLineEnding {
  const endings = content.match(/\r\n|\r|\n/g)
  if (!endings?.length) return null
  return endings.every(value => value === endings[0]) ? endings[0] as TextLineEnding : null
}

export function encodeEditedText(content: string, lineEnding: TextLineEnding, encoding: TextEncoding, bom: boolean): Buffer {
  const normalized = content.replace(/\r\n|\r/g, '\n')
  const text = lineEnding ? normalized.replace(/\n/g, lineEnding) : normalized
  const bytes = iconv.encode(text, encoding)
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== text) throw new LocalizedError(msg('errors.textContainsCharactersUnsupportedByThisEncodingConvertToUtf'))
  if (bom && encoding !== 'utf8') throw new LocalizedError(msg('errors.gbkDoesNotSupportAUtf8Bom'))
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]) : bytes
}

/** Returns the remote save script with a dependency gate before staging or updating the target. */
export function buildTextSaveCommand(): string {
  return `set -euo pipefail
destination=$1
expected_hash=$2
expected_identity=$3
force=$4
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
${receiveStagedFile('$5')}
[[ -f "$destination" && ! -L "$destination" && $(stat -c %h -- "$destination") == 1 ]] || exit 1
original_metadata=$(metadata "$destination")
cp --attributes-only --preserve=all -- "$destination" "$temporary"
touch -m -- "$temporary"
copied_metadata=$(metadata "$temporary")
[[ $copied_metadata == "$original_metadata" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:preserveMetadata' >&2; exit 1; }
current_hash=$(sha256sum < "$destination")
current_hash=\${current_hash%% *}
current_identity=$(stat -c '%d:%i:%s:%y:%z' -- "$destination")
if [[ $force != 1 && ( $current_hash != "$expected_hash" || $current_identity != "$expected_identity" ) ]]; then
  printf 'LINUX_NEXUS_TEXT_CONFLICT:%s\\n' "$current_hash" >&2
  exit 73
fi
mv -fT -- "$temporary" "$destination"
trap - EXIT HUP INT TERM
sha256sum < "$destination"
stat -c '%d:%i:%s:%y:%z' -- "$destination"`
}

function parseVersion(hashLine: string, identity: string): TextFileVersion {
  const hash = hashLine.split(' ')[0]
  if (!hashPattern.test(hash) || !identity) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersion'))
  return { hash, identity }
}

export const textPreviewStrategy: PreviewStrategy<TextPreviewResult> = {
  types: ['text', 'markdown'],
  /** Builds the requested text or Markdown preview from the versioned remote file. */
  async preview({ type, sessionId, profileId, client, remotePath, name, limitBytes, encoding }) {
    const result = await readVersionedText(client, remotePath, limitBytes, encoding)
    if (type === 'markdown') {
      const token = randomUUID()
      registerMarkdownResources(token, sessionId, profileId)
      return { type, name, content: result.content, token,
        resourceBaseUrl: 'remote-preview://' + token + remotePath.split('/').map(encodeURIComponent).join('/') }
    }
    return { type: 'text', name, ...result }
  },
}

/** Reads a regular text file at remotePath with a byte limit and an optional encoding and cancellation signal. */
export async function readVersionedText(client: Parameters<typeof runRemoteCommand>[0], remotePath: string,
  limitBytes: number, encoding?: TextEncoding, signal?: AbortSignal) {
  const { stdout } = await runRemoteCommand(client, `set -eu
[[ -f "$1" && ! -L "$1" ]]
before=$(stat -c '%d:%i:%s:%y:%z' -- "$1")
[[ $(stat -c '%s' -- "$1") -le "$2" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:textSizeLimit' >&2; exit 1; }
hash=$(sha256sum < "$1"); hash=\${hash%% *}
printf '%s\\0%s\\0' "$hash" "$before"
cat -- "$1"
[[ $(stat -c '%d:%i:%s:%y:%z' -- "$1") == "$before" ]] || { printf '%s\\n' 'LINUX_NEXUS_DIAGNOSTIC:readChanged' >&2; exit 1; }`, [remotePath, String(limitBytes)], { maxStdoutBytes: limitBytes + 1024, signal })
  const first = stdout.indexOf(0)
  const second = stdout.indexOf(0, first + 1)
  if (first !== 64 || second < 0) throw new LocalizedError(msg('errors.serverReturnedAnInvalidTextVersionFormat'))
  const version = parseVersion(stdout.subarray(0, first).toString(), stdout.subarray(first + 1, second).toString())
  const buffer = stdout.subarray(second + 1)
  if (buffer.length > limitBytes) throw new LocalizedError(msg('errors.textExceedsThePreviewLimit'))
  if (createHash('sha256').update(buffer).digest('hex') !== version.hash) throw new LocalizedError(msg('errors.fileChangedWhileBeingReadReopenIt'))
  const decoded = decodeText(buffer, encoding)
  return { ...decoded, version, lineEnding: detectTextLineEnding(decoded.content) }
}

/**
 * Saves a draft in an active file session after verifying metadata tool availability.
 * @param sessionId File session and current remote command identity.
 * @param remotePath Destination on the server.
 * @param content Edited draft.
 * @param lineEnding Requested line ending, validated before writing.
 * @param options Encoding, original version and overwrite policy.
 * @returns The committed version, conflict status or dependency proposal.
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

/** Saves text using the supplied command scope and version, optionally cancelling with signal. */
export async function saveVersionedText(commands: Parameters<typeof runRemoteCommand>[0], remotePath: string,
  content: string, lineEnding: unknown, options: TextSaveOptions, signal?: AbortSignal): Promise<TextSaveResult> {
  if (typeof content !== 'string' || !options || typeof options !== 'object'
    || !options.version || !hashPattern.test(options.version.hash) || typeof options.version.identity !== 'string'
    || (options.encoding !== 'utf8' && options.encoding !== 'gbk') || typeof options.bom !== 'boolean' || typeof options.force !== 'boolean'
    || (lineEnding !== null && lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r')) throw new LocalizedError(msg('errors.invalidTextSaveParameters'))
  const path = normalizedRemotePath(remotePath)
  const bytes = encodeEditedText(content, lineEnding, options.encoding, options.bom)
  if (bytes.length > readPreviewLimits().textMiB * 1024 * 1024) throw new LocalizedError(msg('errors.savedTextExceedsThePreviewLimit'))
  try {
    const { stdout } = await runRemoteCommand(commands, buildTextSaveCommand(), [path, options.version.hash, options.version.identity, options.force ? '1' : '0', String(bytes.length)], { signal, stdin: [bytes, commitRecord(createHash('sha256').update(bytes).digest('hex'))], maxStdoutBytes: 1024 })
    const [hash, identity] = stdout.toString().trimEnd().split('\n')
    const version = parseVersion(hash, identity)
    if (version.hash !== createHash('sha256').update(bytes).digest('hex')) throw new LocalizedError(msg('errors.fileChangedAgainAfterSavingReloadItYourDraftHas'))
    return { status: 'saved', version }
  } catch (error) {
    if (error instanceof RemoteCommandError && error.exitCode === 73 && error.stderr.startsWith('LINUX_NEXUS_TEXT_CONFLICT:')) return { status: 'conflict' }
    throw error
  }
}
