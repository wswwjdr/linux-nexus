import assert from 'node:assert/strict'
import test from 'node:test'
import { errorMessage } from '../src/renderer/src/app-utils.ts'
import { LocalizedError, msg, renderMessage } from '../src/shared/i18n/messages'

test('preserves structured errors and original diagnostics without IPC string parsing', () => {
  const message = msg('errors.connectionFailed')
  assert.deepEqual(errorMessage(new LocalizedError(message)), message)
  const diagnostic = 'unzip: cannot create /target/file\nPermission denied'
  assert.equal(errorMessage(new Error(diagnostic)), diagnostic)
  const literal = "Error invoking remote method 'example': literal server output"
  assert.equal(errorMessage(new Error(literal)), literal)
})

test('uses an application failure message when no diagnostic exists', () => {
  assert.equal(renderMessage(errorMessage(undefined)), '操作失败，请重试')
})
