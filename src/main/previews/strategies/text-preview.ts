import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { Readable } from 'node:stream'
import type { PreviewResult, TextLineEnding } from '@shared/types'
import { filesSession, normalizedRemotePath } from '../../remote-fs'
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

function detectTextLineEnding(content: string): TextLineEnding {
  const lineEndings = content.match(/\r\n|\r|\n/g)
  if (!lineEndings?.length) return null
  const [lineEnding] = lineEndings
  if (lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r') return null
  return lineEndings.every((candidate) => candidate === lineEnding) ? lineEnding : null
}

function encodeEditedText(content: string, lineEnding: TextLineEnding): Buffer {
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
    'mv -fT -- "$temporary" "$destination"',
    'trap - EXIT HUP INT TERM',
  ].join('\n')
}

async function readTextFile(
  client: ReturnType<typeof filesSession>['client'],
  remotePath: string,
  limitBytes: number,
  limitMiB: number,
): Promise<Buffer> {
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
  return buffer
}

export const textPreviewStrategy: PreviewStrategy<TextPreviewResult> = {
  types: ['text', 'markdown'],
  async preview({ type, client, remotePath, name, limitBytes, limitMiB }) {
    const buffer = await readTextFile(client, remotePath, limitBytes, limitMiB)
    const decodedContent = decodeText(buffer)
    if (type === 'markdown') return { type, name, content: decodedContent }
    return {
      type: 'text',
      name,
      content: decodedContent,
      lineEnding: detectTextLineEnding(decodedContent),
    }
  },
}

export async function saveTextFile(
  sessionId: string,
  remotePath: string,
  content: string,
  lineEnding: unknown,
): Promise<void> {
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('文件会话未连接')
  if (typeof content !== 'string') throw new Error('文本内容无效')
  if (lineEnding !== null && lineEnding !== '\n' && lineEnding !== '\r\n' && lineEnding !== '\r') {
    throw new Error('文本换行格式无效')
  }

  const session = filesSession(sessionId)
  const normalizedPath = normalizedRemotePath(remotePath)
  const limitMiB = readPreviewLimits().textMiB
  const limitBytes = limitMiB * 1024 * 1024
  const savedContent = encodeEditedText(content, lineEnding)
  if (savedContent.length > limitBytes) throw saveSizeError(limitMiB)

  await runRemoteCommand(session.client, buildTextSaveCommand(),
    [normalizedPath], {
    stdin: Readable.from([savedContent]),
    collectStdout: false,
  })
}
