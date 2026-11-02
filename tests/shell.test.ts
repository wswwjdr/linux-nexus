import assert from 'node:assert/strict'
import test from 'node:test'
import { scriptExecutionCommand, shellQuote, shellQuoteIfNeeded } from '../src/shared/shell.ts'

test('quotes shell arguments containing spaces, quotes, and metacharacters', () => {
  assert.equal(shellQuote('plain-name'), "'plain-name'")
  assert.equal(shellQuote("O'Brien; $(touch /tmp/nope)"), "'O'\\''Brien; $(touch /tmp/nope)'")
  assert.throws(() => shellQuote('bad\0name'))
})

test('builds script execution commands from a quoted relative filename', () => {
  assert.equal(scriptExecutionCommand('run.sh'), "./'run.sh'")
  assert.equal(scriptExecutionCommand("job's name.py"), "./'job'\\''s name.py'")
})

test('omits quotes for simple paths and protects shell-sensitive paths', () => {
  for (const path of ['/', '/home/user', '/opt/my-app_v1.2']) {
    assert.equal(shellQuoteIfNeeded(path), path)
  }
  for (const path of ['', '/home/my files', "/home/O'Brien", '/tmp/$HOME', '/tmp/$(id)', '/tmp/a;b', '/tmp/*', '/tmp/a\nb', '/tmp/目录']) {
    assert.equal(shellQuoteIfNeeded(path), shellQuote(path))
  }
  assert.throws(() => shellQuoteIfNeeded('bad\0name'))
})
