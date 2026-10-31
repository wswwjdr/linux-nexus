import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

test('themes render accessibly, persist, follow nativeTheme and preserve the live SSH terminal', { timeout: 90_000 }, async () => {
  const { default: electron } = await import('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(electron as unknown as string, [fileURLToPath(new URL('./helpers/theme-browser.cjs', import.meta.url))], { env, windowsHide: true, timeout: 75_000 })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('exit', code => resolve({ code, output }))
  })
  assert.equal(result.code, 0, result.output)
  assert.match(result.output, /theme browser checks passed/)
})
