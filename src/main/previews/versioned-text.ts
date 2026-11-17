import { createHash } from 'node:crypto'
import type { TextSaveOptions, TextSaveResult } from '@shared/types'
import { msg, LocalizedError } from '../../shared/i18n/messages'
import { DependencyRequiredError } from '../../shared/dependency-error'
import { commitRecord } from '../staged-write'
import { filesSession, normalizedRemotePath } from '../remote-fs'
import { runRemoteCommand } from '../ssh-commands'
import { readPreviewLimits } from '../state-store'
import { operationCapabilityReport } from '../server-capabilities'
import { offerFileDependencies } from '../file-dependencies'
import { fileHashPattern, parseFileVersion, versionedWriteCapabilities, writeVersionedFile } from '../versioned-write'
import { encodeEditedText } from './text-codec'

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
  const version = parseFileVersion(stdout.subarray(0, first).toString(), stdout.subarray(first + 1, second).toString())
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
    const report = operationCapabilityReport(error, versionedWriteCapabilities)
    if (!report) throw error
    throw new DependencyRequiredError(offerFileDependencies(sessionId, commands, 'text-save', versionedWriteCapabilities, report))
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
    || !options.version || typeof options.version.hash !== 'string' || !fileHashPattern.test(options.version.hash)
    || typeof options.version.identity !== 'string' || !options.version.identity || /[\x00\t\r\n]/.test(options.version.identity)
    || (options.encoding !== 'utf8' && options.encoding !== 'gbk') || typeof options.bom !== 'boolean'
    || (lineEnding !== null && lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r')) throw new LocalizedError(msg('errors.invalidTextSaveParameters'))
  const path = normalizedRemotePath(remotePath)
  const bytes = encodeEditedText(content, lineEnding, options.encoding, options.bom)
  if (bytes.length > readPreviewLimits().textMiB * 1024 * 1024) throw new LocalizedError(msg('errors.savedTextExceedsThePreviewLimit'))
  const draftHash = createHash('sha256').update(bytes).digest('hex')
  return writeVersionedFile(commands, path, options.version, bytes.length, draftHash, [bytes, commitRecord(draftHash)])
}
