import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import test from 'node:test'
import { readRemoteBytes } from '../src/main/remote-byte-reader.ts'
import { baseCapabilities, checkCapabilities } from '../src/main/server-capabilities.ts'
import type { RemoteCommandExecutor } from '../src/main/ssh-commands.ts'
import { shellQuote } from '../src/shared/shell.ts'

const git = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH ?? (git ? resolve(dirname(git), '../bin/bash.exe') : 'bash')
const withTools = { skip: spawnSync(bash, ['-c', 'command -v dd && command -v head']).status !== 0 }
const executeLocal = promisify(execFile)

/** Converts a local fixture path to the path used by the test Bash environment. */
function shellPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase())
}

test('checks dd behavior without a version banner and reads exact bytes from a large, unaligned offset', withTools, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexus-range-'))
  const local = join(directory, "video ' sample")
  const offset = 32 * 1024 * 1024 + 17
  const sentinel = Buffer.from([0, 1, 17, 255, 128, 23, 41])
  const prefix = Buffer.from([69, 0, 255])
  const file = await open(local, 'wx')
  try {
    await file.write(prefix, 0, prefix.length, 0)
    await file.write(sentinel, 0, sentinel.length, offset)
  } finally { await file.close() }
  try {
    // The executable deliberately rejects `--version`, while its data behavior remains valid.
    await writeFile(join(directory, 'dd'), '#!/bin/sh\n[ "$1" != --version ] || exit 2\nexec /usr/bin/dd "$@"\n', { mode: 0o755 })
    const exec: RemoteCommandExecutor = {
      async execute(command, options) {
        const { stdout, stderr } = await executeLocal(bash, ['-c', `PATH=${shellQuote(shellPath(directory))}:"$PATH" ${command}`],
          { encoding: 'buffer', signal: options?.signal })
        await options?.onStdout?.(stdout)
        return { stdout: options?.collectStdout === false ? Buffer.alloc(0) : stdout, stderr: stderr.toString(), exitCode: 0 }
      },
    }
    const path = shellPath(local)
    assert.equal(baseCapabilities.includes('dd'), false)
    assert.deepEqual(await checkCapabilities(exec, ['dd', 'head']), { missing: [], incompatible: [] })
    assert.deepEqual(await readRemoteBytes(exec, path, { offset, length: sentinel.length, error: 'short read' }), sentinel)
    assert.deepEqual(await readRemoteBytes(exec, path, { length: prefix.length, error: 'short read' }), prefix)
    await assert.rejects(readRemoteBytes(exec, path, { offset, length: sentinel.length + 1, error: 'short read' }), /short read/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(readRemoteBytes(exec, path, { offset, length: sentinel.length, error: 'short read', signal: controller.signal }), { name: 'AbortError' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
