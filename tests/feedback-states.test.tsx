import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ScriptExecutionDialogState, TransferJob } from '../src/renderer/src/app-types.ts'
import ScriptExecutionDialog from '../src/renderer/src/components/ScriptExecutionDialog.tsx'
import TransferTray from '../src/renderer/src/components/TransferTray.tsx'

test('finished scripts with no output do not keep telling the user to wait', () => {
  const execution: ScriptExecutionDialogState = {
    request: { requestId: 'request', sessionId: 'session', scriptPath: '/test.sh', command: 'bash test.sh' },
    name: 'test.sh', status: 'running', output: [], message: null,
  }
  const render = (status: ScriptExecutionDialogState['status']) => renderToStaticMarkup(createElement(
    ScriptExecutionDialog,
    { active: true, execution: { ...execution, status }, onClose: () => {}, onStop: () => {} },
  ))
  assert.ok(render('running').includes('等待脚本输出'))
  for (const status of ['completed', 'cancelled', 'failed'] as const) {
    const markup = render(status)
    assert.ok(markup.includes('脚本没有输出'))
    assert.ok(!markup.includes('等待脚本输出'))
  }
})

test('transfer failures are distinguished from successful completion, including when every item fails', () => {
  const job: TransferJob = {
    sessionId: 'session', profileName: 'server', name: 'files', direction: 'upload',
    transferred: 0, total: 0, completedFiles: 0, failedFiles: 1, activeFiles: [],
    failures: [{ path: '/file', message: 'Permission denied' }], state: 'completed-with-errors',
  }
  const render = (transfer: TransferJob) => renderToStaticMarkup(createElement(
    TransferTray,
    { sessionId: 'session', transfers: { request: transfer }, onCancel: () => {}, onDismiss: () => {} },
  ))
  for (const completedFiles of [0, 2]) {
    const markup = render({ ...job, completedFiles })
    assert.ok(markup.includes('上传结束'))
    assert.ok(markup.includes('1 项失败'))
    assert.ok(markup.includes('Permission denied'))
    assert.ok(!markup.includes('上传已完成'))
  }
  const success = render({ ...job, direction: 'download', state: 'complete', completedFiles: 2, failedFiles: 0, failures: [] })
  assert.ok(success.includes('下载已完成'))
  assert.ok(!success.includes('项失败'))
})
