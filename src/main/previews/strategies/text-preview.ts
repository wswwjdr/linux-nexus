import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { Readable } from 'node:stream'
import type { PreviewResult, TextFileRevision, TextFileSaveConflict, TextFileSaveResult } from '@shared/types'
import { filesSession, normalizedRemotePath, remotePathType } from '../../remote-fs'
import { runRemoteCommand } from '../../ssh-commands'
import { readPreviewLimits } from '../../state-store'
import { previewSizeError, type PreviewStrategy } from '../preview-strategy'

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/
type TextPreviewResult = Extract<PreviewResult, { type: 'text' | 'markdown' }>

function saveSizeError(limitMiB: number): Error {
  return new Error('保存后的文本超过 ' + limitMiB + ' MiB 上限')
}

function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    return new TextDecoder('gbk').decode(buffer)
  }
}

function detectTextLineEnding(content: string): TextFileRevision['lineEnding'] {
  const lineEndings = content.match(/\r\n|\r|\n/g)
  if (!lineEndings?.length) return null
  const [lineEnding] = lineEndings
  if (lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r') return null
  return lineEndings.every((candidate) => candidate === lineEnding) ? lineEnding : null
}

function textRevision(buffer: Buffer, content = decodeText(buffer)): TextFileRevision {
  return {
    contentHash: createHash('sha256').update(buffer).digest('hex'),
    lineEnding: detectTextLineEnding(content),
  }
}

function encodeEditedText(content: string, lineEnding: TextFileRevision['lineEnding']): Buffer {
  const normalizedContent = content.replace(/\r\n|\r/g, '\n')
  const savedContent = lineEnding && lineEnding !== '\n'
    ? normalizedContent.replace(/\n/g, lineEnding)
    : normalizedContent
  return Buffer.from(savedContent, 'utf8')
}

export function buildTextSaveCommand(): string {
  return [
    'set -eu',
    'destination=$1',
    'expected_hash=$2; force=$3',
    '[[ -f "$destination" && ! -L "$destination" ]] || { printf "%s\\n" "目标文件已变化" >&2; exit 1; }',
    'directory=$(dirname -- "$destination")',
    'name=$(basename -- "$destination")',
    'temporary=$(mktemp -- "$directory/.$name.edit.XXXXXX")',
    'trap \'rm -f -- "$temporary"\' EXIT',
    'trap \'exit 129\' HUP',
    'trap \'exit 130\' INT',
    'trap \'exit 143\' TERM',
    'cat > "$temporary"',
    'chmod --reference="$destination" -- "$temporary"',
    'current_hash=$(sha256sum -- "$destination"); current_hash=${current_hash%% *}',
    'if [[ $force != 1 && $current_hash != "$expected_hash" ]]; then printf "LINUX_NEXUS_TEXT_CONFLICT:%s" "$current_hash" >&2; exit 73; fi',
    'mv -fT -- "$temporary" "$destination"',
    'trap - EXIT HUP INT TERM',
  ].join('\n')
}

async function readTextFile(
  client: ReturnType<typeof filesSession>['client'],
  remotePath: string,
  limitBytes: number,
  limitMiB: number,
): Promise<{ buffer: Buffer; serverHash: string }> {
  const { stdout } = await runRemoteCommand(client,
    'set -eu; hash=$(sha256sum -- "$1"); hash=${hash%% *}; printf "%s\\0" "$hash"; cat -- "$1"',
    [remotePath],
    { maxStdoutBytes: limitBytes + 65 },
  )
  const separator = stdout.indexOf(0)
  if (separator !== 64) throw new Error('服务器返回的文本版本格式无效')
  const serverHash = stdout.subarray(0, separator).toString('ascii')
  if (!CONTENT_HASH_PATTERN.test(serverHash)) throw new Error('服务器返回的文件哈希无效')
  const buffer = stdout.subarray(separator + 1)
  if (buffer.length > limitBytes) throw previewSizeError(limitMiB)
  if (createHash('sha256').update(buffer).digest('hex') !== serverHash) throw new Error('文件在读取期间发生变化，请重新打开预览')
  return { buffer, serverHash }
}

function assertTextFileRevision(value: unknown): asserts value is TextFileRevision {
  if (typeof value !== 'object' || value === null
    || !('contentHash' in value)
    || typeof value.contentHash !== 'string'
    || !CONTENT_HASH_PATTERN.test(value.contentHash)
    || !('lineEnding' in value)
    || (value.lineEnding !== null && value.lineEnding !== '\n' && value.lineEnding !== '\r\n' && value.lineEnding !== '\r')) {
    throw new Error('文本版本无效，请重新打开预览')
  }
}

export const textPreviewStrategy: PreviewStrategy<TextPreviewResult> = {
  types: ['text', 'markdown'],
  async preview({ type, client, remotePath, name, limitBytes, limitMiB }) {
    const { buffer, serverHash } = await readTextFile(client, remotePath, limitBytes, limitMiB)
    const decodedContent = decodeText(buffer)
    if (type === 'markdown') return { type, name, content: decodedContent }
    return {
      type: 'text',
      name,
      content: decodedContent,
      revision: { ...textRevision(buffer, decodedContent), contentHash: serverHash },
    }
  },
}

export async function saveTextFile(
  sessionId: string,
  remotePath: string,
  content: string,
  expectedRevision: unknown,
  forceOverwrite = false,
): Promise<TextFileSaveResult | TextFileSaveConflict> {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('文件会话未连接')
  if (typeof content !== 'string') throw new Error('文本内容无效')
  if (typeof forceOverwrite !== 'boolean') throw new Error('覆盖选项无效')
  assertTextFileRevision(expectedRevision)

  const session = filesSession(sessionId)
  const normalizedPath = normalizedRemotePath(remotePath)
  if (await remotePathType(session.client, normalizedPath) !== 'file') throw new Error('只能保存普通文件')
  const limitMiB = readPreviewLimits().textMiB
  const limitBytes = limitMiB * 1024 * 1024
  const savedContent = encodeEditedText(content, expectedRevision.lineEnding)
  if (savedContent.length > limitBytes) throw saveSizeError(limitMiB)

  const { stdout: hashOutput } = await runRemoteCommand(session.client,
    'hash=$(sha256sum -- "$1"); printf "%s" "${hash%% *}"',
    [normalizedPath],
  )
  const currentHash = hashOutput.toString('ascii')
  if (!CONTENT_HASH_PATTERN.test(currentHash)) throw new Error('服务器返回的文件哈希无效')
  if (!forceOverwrite && currentHash !== expectedRevision.contentHash) return { status: 'conflict', currentHash }

  try {
    await runRemoteCommand(session.client, buildTextSaveCommand(),
      [normalizedPath, expectedRevision.contentHash, forceOverwrite ? '1' : '0'], {
      stdin: Readable.from([savedContent]),
      collectStdout: false,
    })
  } catch (error) {
    const conflict = /^LINUX_NEXUS_TEXT_CONFLICT:([a-f0-9]{64})$/.exec(error instanceof Error ? error.message : String(error))
    if (conflict) return { status: 'conflict', currentHash: conflict[1] }
    throw error
  }

  return { status: 'saved', revision: textRevision(savedContent) }
}
