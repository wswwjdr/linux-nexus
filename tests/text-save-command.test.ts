import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTextSaveCommand } from '../src/main/previews/strategies/text-preview.ts'

test('rechecks the saved SHA-256 immediately before atomically replacing a text file', () => {
  const command = buildTextSaveCommand()
  const streamInput = command.indexOf('cat > "$temporary"')
  const hashCheck = command.indexOf('current_hash=$(sha256sum -- "$destination")')
  const replace = command.indexOf('mv -fT -- "$temporary" "$destination"')

  assert.ok(streamInput >= 0 && streamInput < hashCheck)
  assert.ok(hashCheck < replace)
  assert.ok(command.includes('LINUX_NEXUS_TEXT_CONFLICT:%s'))
  assert.ok(command.includes('force != 1'))
  assert.ok(command.includes('trap \'rm -f -- "$temporary"\' EXIT'))
  assert.ok(command.includes("trap 'exit 143' TERM"))
})
