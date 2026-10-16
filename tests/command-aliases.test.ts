import assert from 'node:assert/strict'
import test from 'node:test'
import {
  connectionIdentityChanged,
  countExactLines,
  formatBashAliasDefinition,
  normalizeStoredCommandAliases,
  parseCommandAliasProtocol,
  validateCommandAlias,
} from '../src/shared/command-aliases.ts'

test('parses framed alias records while ignoring shell startup output', () => {
  const begin = '__BEGIN_TEST__'
  const end = '__END_TEST__'
  const output = Buffer.from([
    'startup message',
    begin,
    'll', 'ls -alF', "alias ll='ls -alF'", '1',
    'say', "printf 'hello'", String.raw`alias say='printf '\''hello'\'''`, '0',
    end,
    'other output',
  ].join('\0'))

  assert.deepEqual(parseCommandAliasProtocol(output, begin, end), [
    { name: 'll', command: 'ls -alF', definition: "alias ll='ls -alF'", removable: true },
    { name: 'say', command: "printf 'hello'", definition: String.raw`alias say='printf '\''hello'\'''`, removable: false },
  ])
})

test('rejects incomplete or duplicate alias protocol records', () => {
  assert.throws(() => parseCommandAliasProtocol(['__BEGIN__', 'll', 'ls'].join('\0'), '__BEGIN__', '__END__'))
  assert.throws(() => parseCommandAliasProtocol(['__BEGIN__', 'll', 'a', "alias ll='a'", '1', 'll', 'b', "alias ll='b'", '1', '__END__'].join('\0'), '__BEGIN__', '__END__'))
})

test('formats single-line Bash definitions without allowing syntax injection', () => {
  assert.equal(formatBashAliasDefinition('ll', 'ls -alF'), "alias ll='ls -alF'")
  assert.equal(formatBashAliasDefinition('say', "printf 'hello'"), String.raw`alias say='printf '\''hello'\'''`)
  assert.throws(() => validateCommandAlias('2ll', 'ls'))
  assert.throws(() => validateCommandAlias('ll', 'echo safe\necho injected'))
  assert.throws(() => validateCommandAlias('ll', 'echo\0bad'))
})

test('counts only whole-line matches for safe deletion', () => {
  const definition = "alias ll='ls -alF'"
  assert.equal(countExactLines(`before\n${definition}\nafter\n`, definition), 1)
  assert.equal(countExactLines(`alias ll="ls -alF"\n`, definition), 0)
  assert.equal(countExactLines(`${definition}\n${definition}\n`, definition), 2)
})

test('treats legacy server state as having no alias snapshots', () => {
  assert.deepEqual(normalizeStoredCommandAliases(undefined, new Set(['server-1'])), {})
  assert.throws(() => normalizeStoredCommandAliases({ removed: {
    profileId: 'removed', aliases: [], syncedAt: null, status: 'unsynced',
  } }, new Set(['server-1'])))
})

test('invalidates aliases only when the connection identity changes', () => {
  const previous = { id: 'server-1', name: 'Production', host: 'host.example', port: 22, username: 'deploy' }
  assert.equal(connectionIdentityChanged(previous, { ...previous, name: 'Prod' }), false)
  assert.equal(connectionIdentityChanged(previous, { ...previous, host: 'new.example' }), true)
  assert.equal(connectionIdentityChanged(previous, { ...previous, port: 2222 }), true)
  assert.equal(connectionIdentityChanged(previous, { ...previous, username: 'root' }), true)
})
