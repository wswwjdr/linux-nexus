import assert from 'node:assert/strict'
import test from 'node:test'
import { scriptExecutionCommand, shellQuote } from '../src/shared/shell.ts'

test('quotes shell arguments containing spaces, quotes, and metacharacters', () => {
  assert.equal(shellQuote('plain-name'), "'plain-name'")
  assert.equal(shellQuote("O'Brien; $(touch /tmp/nope)"), "'O'\\''Brien; $(touch /tmp/nope)'")
  assert.throws(() => shellQuote('bad\0name'))
})

test('builds script execution commands from a quoted relative filename', () => {
  assert.equal(scriptExecutionCommand('run.sh'), "./'run.sh'")
  assert.equal(scriptExecutionCommand("job's name.py"), "./'job'\\''s name.py'")
})
