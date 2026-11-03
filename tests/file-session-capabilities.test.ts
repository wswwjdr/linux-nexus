import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import type { Client, ClientChannel } from 'ssh2'
import { buildFileSessionCapabilityScript, verifyFileSessionCapabilities } from '../src/main/file-session-capabilities.ts'
import { buildRemoteCommand } from '../src/main/ssh-commands.ts'

const gitPath = process.platform === 'win32'
  ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0]
  : undefined
const bash = process.env.LINUX_NEXUS_TEST_BASH
  ?? (gitPath ? resolve(dirname(gitPath), '../bin/bash.exe') : 'bash')
const hasGnuTools = spawnSync(bash, ['-c', 'find --version && cp --version && grep --version && tar --version']).status === 0
const shellTest = { skip: !hasGnuTools && 'Bash and GNU tools are required' }

function checkRelease(release: string, prefix = '') {
  const directory = mkdtempSync(join(tmpdir(), 'linux-nexus-release-'))
  const releasePath = join(directory, 'os-release')
  writeFileSync(releasePath, release)
  try {
    // Substitute only the data input, leaving the production admission script intact.
    const script = buildFileSessionCapabilityScript().replace('/etc/os-release', '"$1"')
    return spawnSync(bash, ['-c', prefix + '\n' + script, '--', releasePath], { encoding: 'utf8', timeout: 10_000 })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('accepts CentOS 7 and the existing supported distribution versions', shellTest, () => {
  for (const [id, versions] of [
    ['centos', ['7', '7.9.2009', '8', '8.5.2111', '9', '10']],
    ['rhel', ['8', '8.10', '9.4', '10.0']],
    ['ubuntu', ['20.04', '24.04']],
    ['debian', ['11', '12', '13']],
  ] as const) {
    for (const version of versions) {
      const result = checkRelease(`NAME="Linux"\nID=${id}\nVERSION_ID="${version}"\n`)
      assert.equal(result.status, 0, `${id} ${version}: ${result.stderr}`)
      assert.equal(result.stdout, '')
    }
  }
})

test('accepts single quotes and an unterminated final line without executing other fields', shellTest, () => {
  const result = checkRelease("NAME=$(exit 99)\n# comment\nID='centos'\nVERSION_ID='7'")
  assert.equal(result.status, 0, result.stderr)
})

test('rejects unsupported distributions and exact major versions before probing tools', shellTest, () => {
  for (const [id, version] of [['centos', '6'], ['centos', '70'], ['centos', '80'], ['centos', '11'], ['rhel', '7'], ['rhel', '80'], ['rocky', '9'], ['alpine', '3.20']]) {
    const result = checkRelease(`ID=${id}\nVERSION_ID=${version}\n`, 'command() { printf "unexpected tool probe" >&2; return 1; }')
    assert.equal(result.status, 1)
    assert.equal(result.stderr, `不支持的服务器发行版: ${id} ${version}\n`)
  }
})

test('rejects missing, malformed and executable identity values as data', shellTest, () => {
  for (const release of ['', 'ID=centos\n', 'VERSION_ID=7\n', 'ID=centos\nVERSION_ID="7\n', 'ID=centos\nVERSION_ID=7anything\n', 'ID=centos\nVERSION_ID="$(exit 99)"\n']) {
    const result = checkRelease(release)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /服务器发行版信息无效/)
  }
  const directory = mkdtempSync(join(tmpdir(), 'linux-nexus-release-injection-'))
  try {
    const marker = join(directory, 'executed').replaceAll('\\', '/')
    const result = checkRelease(`ID=centos\nVERSION_ID="7"\ntouch '${marker}'\n`)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(marker), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('reports missing commands, non-GNU tools and unsupported command options', shellTest, () => {
  for (const [prefix, message] of [
    ['command() { if [[ "$2" == sha256sum ]]; then return 1; fi; builtin command "$@"; }', '缺少服务器命令: sha256sum'],
    ['find() { printf "BSD find\\n"; }', '需要 GNU findutils'],
    ['cp() { printf "BSD cp\\n"; }', '需要 GNU coreutils'],
    ['grep() { if [[ "$1" == --version ]]; then printf "BSD grep\\n"; else command grep "$@"; fi; }', '需要 GNU grep'],
    ['tar() { printf "BSD tar\\n"; }', '需要 GNU tar'],
    ['dd() { printf "unsupported dd option\\n" >&2; return 2; }', 'unsupported dd option'],
    ['tar() { if [[ "$1" == --skip-old-files ]]; then printf "unsupported tar policy\\n" >&2; return 2; fi; command tar "$@"; }', 'unsupported tar policy'],
  ]) {
    const result = checkRelease('ID=centos\nVERSION_ID=7\n', prefix)
    assert.notEqual(result.status, 0, prefix)
    assert.match(result.stderr, new RegExp(message))
  }
})

test('runs admission through one SSH command and propagates server errors', async () => {
  for (const failure of ['', '缺少服务器命令: sha256sum\n', '/etc/os-release: No such file or directory\n']) {
    const commands: string[] = []
    const client = new EventEmitter() as Client & EventEmitter
    client.exec = (command: string, callback: (error: Error | undefined, channel: ClientChannel) => void) => {
      commands.push(command)
      const channel = new EventEmitter() as EventEmitter & { stderr: EventEmitter; end: () => void }
      channel.stderr = new EventEmitter()
      channel.end = () => {
        if (failure) channel.stderr.emit('data', Buffer.from(failure))
        channel.emit('exit', failure ? 1 : 0)
        channel.emit('close', failure ? 1 : 0)
      }
      callback(undefined, channel as unknown as ClientChannel)
      return client
    }
    if (failure) await assert.rejects(verifyFileSessionCapabilities(client), { message: failure })
    else await verifyFileSessionCapabilities(client)
    assert.deepEqual(commands, [buildRemoteCommand(buildFileSessionCapabilityScript())])
    assert.equal(client.listenerCount('error'), 0)
    assert.equal(client.listenerCount('close'), 0)
  }
})
