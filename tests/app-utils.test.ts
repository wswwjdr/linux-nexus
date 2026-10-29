import assert from 'node:assert/strict'
import test from 'node:test'
import { errorMessage } from '../src/renderer/src/app-utils.ts'

test('shows the original failure reason without Electron IPC implementation details', () => {
  const diagnostic = 'unzip: cannot create /target/file\nPermission denied'
  assert.equal(errorMessage(new Error(
    "Error invoking remote method 'files:operation-execute': Error: " + diagnostic,
  )), diagnostic)
  assert.equal(errorMessage(new Error(
    "Error invoking remote method 'files:list': 无法读取目录",
  )), '无法读取目录')
})

test('preserves ordinary error details and uses the existing fallback for unknown failures', () => {
  const diagnostic = "服务器错误：Error invoking remote method 'example': Error: details"
  assert.equal(errorMessage(new Error(diagnostic)), diagnostic)
  assert.equal(errorMessage(new Error('文件名包含 Error: 字样')), '文件名包含 Error: 字样')
  assert.equal(errorMessage(undefined), '操作失败，请重试')
})
