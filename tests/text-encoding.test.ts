import assert from 'node:assert/strict'
import test from 'node:test'
import iconv from 'iconv-lite'
import { decodeText, encodeEditedText } from '../src/main/previews/strategies/text-preview.ts'
import { assertWindowsPath, localDestination } from '../src/main/transfers/shared.ts'

test('GBK and BOM UTF-8 round trip exactly and reject lossy edits', () => {
  const gbk = iconv.encode('中文配置\r\n', 'gbk')
  const read = decodeText(gbk)
  assert.equal(read.encoding, 'gbk')
  assert.deepEqual(encodeEditedText(read.content, '\r\n', read.encoding, read.bom), gbk)
  assert.throws(() => encodeEditedText('emoji 😀', '\n', 'gbk', false), /无法表示/)
  assert.throws(() => decodeText(Buffer.from([0x81]), 'gbk'), /无损/)
  assert.throws(() => decodeText(gbk, 'utf8'))
  const utf8 = Buffer.from('\ufeff中文\n', 'utf8')
  const decoded = decodeText(utf8)
  assert.equal(decoded.bom, true)
  assert.equal(decoded.content, '中文\n')
  assert.deepEqual(encodeEditedText(decoded.content, '\n', decoded.encoding, decoded.bom), utf8)
})

test('Linux backslash names cannot alias Windows directory separators', () => {
  assert.throws(() => assertWindowsPath('a\\b.txt'), /Windows/)
  assert.throws(() => localDestination('C:/downloads', 'a\\b.txt'), /Windows/)
  assert.doesNotThrow(() => assertWindowsPath('a/b.txt'))
})
