import { isUtf8 } from 'node:buffer'
import iconv from 'iconv-lite'
import type { TextEncoding, TextLineEnding } from '@shared/types'
import { LocalizedError, msg } from '../../shared/i18n/messages'

const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf])

/**
 * Decodes text for display, keeping invalid bytes visible as replacement characters.
 * @param bytes Source file bytes, or an aligned page when an encoding is specified.
 * @param selected Explicit read encoding. Omit to detect UTF-8 and try reversible GBK.
 * @param fileStart Whether a UTF-8 BOM at the front belongs to this file.
 * @returns Text, its selected encoding and BOM, and whether decoding replaced bytes.
 */
export function decodeText(bytes: Buffer, selected?: TextEncoding, fileStart = true) {
  const bom = fileStart && selected !== 'gbk' && bytes.subarray(0, utf8Bom.length).equals(utf8Bom)
  const source = bom ? bytes.subarray(utf8Bom.length) : bytes
  const validUtf8 = selected !== 'gbk' && isUtf8(source)
  if (selected === 'gbk' || (!selected && !bom && !validUtf8)) {
    const content = iconv.decode(source, 'gbk', { stripBOM: false })
    if (selected === 'gbk' || iconv.encode(content, 'gbk').equals(source)) {
      return { content, encoding: 'gbk' as const, bom: false, lossy: content.includes('\ufffd') }
    }
  }
  return { content: source.toString('utf8'), encoding: 'utf8' as const, bom, lossy: !validUtf8 }
}

/**
 * Detects a common line ending for restoring it after editing.
 * @param content Decoded original text.
 * @returns The uniform line ending, or null for mixed endings or a single line.
 */
export function detectTextLineEnding(content: string): TextLineEnding {
  let ending: TextLineEnding = null
  for (const [value] of content.matchAll(/\r\n|\r|\n/g)) {
    if (ending !== null && ending !== value) return null
    ending = value as TextLineEnding
  }
  return ending
}

/**
 * Encodes the edited text without losing characters to the target encoding.
 * @param content Current draft.
 * @param lineEnding Uniform line ending to restore, or null to use LF.
 * @param encoding Target file encoding.
 * @param bom Whether to prepend the UTF-8 BOM.
 * @returns The bytes to write.
 */
export function encodeEditedText(content: string, lineEnding: TextLineEnding, encoding: TextEncoding, bom: boolean): Buffer {
  const normalized = content.replace(/\r\n|\r/g, '\n')
  const text = lineEnding && lineEnding !== '\n' ? normalized.replace(/\n/g, lineEnding) : normalized
  const bytes = iconv.encode(text, encoding)
  if (iconv.decode(bytes, encoding, { stripBOM: false }) !== text) throw new LocalizedError(msg('errors.textContainsCharactersUnsupportedByThisEncodingConvertToUtf'))
  if (bom && encoding !== 'utf8') throw new LocalizedError(msg('errors.gbkDoesNotSupportAUtf8Bom'))
  return bom ? Buffer.concat([utf8Bom, bytes]) : bytes
}
