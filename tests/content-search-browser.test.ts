import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('content results measure natural heights, resize and reach the last of 10000 files in Chromium', { timeout: 60000 }, async () => {
  const { default: electron } = await import('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(electron as unknown as string, [fileURLToPath(new URL('./helpers/content-search-browser.cjs', import.meta.url))], { env, windowsHide: true, timeout: 50000 })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('exit', code => resolve({ code, output }))
  })
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /content search browser checks passed/)
  console.log(result.output.split('\n').find(line => line.includes('content search browser checks passed')))
})
