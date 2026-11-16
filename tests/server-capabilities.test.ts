import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { baseCapabilities, buildEnvironmentProbe, capabilityProbe, inspectServer, parseDistribution, posixCommand, requireCapabilities, type ServerEnvironment } from '../src/main/server-capabilities.ts'
import { selectPackageManager } from '../src/main/package-manager.ts'

const git = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0] : undefined
const sh = git ? resolve(dirname(git), '../bin/sh.exe') : '/bin/sh'
const shell = { skip: spawnSync(sh, ['-c', ':']).status !== 0 && 'POSIX shell unavailable' }

test('treats release identity as data, rejects duplicates and tolerates missing fields', () => {
  assert.deepEqual(parseDistribution('ID=rocky\nID_LIKE="rhel centos fedora"\r\nVERSION_ID=9.5\nNAME=$(bad)'), {
    id: 'rocky', like: ['rhel', 'centos', 'fedora'], version: '9.5',
  })
  assert.deepEqual(parseDistribution('ID=centos\nID=$(bad)\nID_LIKE="\$(touch marker)"\nVERSION_ID="9'), {
    id: undefined, like: [], version: undefined,
  })
})

test('unknown or missing distributions with compatible tools can open a file session', async () => {
  for (const release of ['', 'ID=newlinux\nVERSION_ID=99\n', 'ID=\$(exit 99)\n']) {
    const environment = await inspectServer({
      execute: async command => {
        assert.ok(command.startsWith('/bin/sh -c '))
        return { stdout: Buffer.from('1000\0apt-get sudo \0\0' + release), stderr: '', exitCode: 0 }
      },
    })
    assert.equal(environment.effectiveUid, 1000)
    assert.deepEqual(environment.base, { missing: [], incompatible: [] })
    assert.equal(selectPackageManager(environment), undefined)
  }
})

test('maps packages by validated family and detects conflicting manager families', () => {
  const environment: ServerEnvironment = {
    distribution: { id: 'ubuntu', like: ['debian'] }, effectiveUid: 0, canSudo: false,
    managers: ['apt-get', 'dnf', 'yum'], base: { missing: [], incompatible: [] },
  }
  const apt = selectPackageManager(environment)!
  assert.equal(apt.manager, 'apt-get')
  assert.equal(apt.packages.getfacl, 'acl')
  assert.equal(apt.packages.find, 'findutils')
  assert.equal(apt.install(['acl']), posixCommand('PATH=/usr/sbin:/usr/bin:/sbin:/bin\nexport PATH LC_ALL=C DEBIAN_FRONTEND=noninteractive\nexec "$@"',
    ['/usr/bin/apt-get', '-y', '--no-install-recommends', '--no-remove', 'install', 'acl']))
  environment.distribution = { id: 'centos', like: ['rhel'] }
  assert.equal(selectPackageManager(environment)?.manager, 'dnf')
  environment.managers = ['yum']
  assert.equal(selectPackageManager(environment)?.manager, 'yum')
  environment.distribution.like.push('debian')
  environment.managers.push('apt-get')
  assert.equal(selectPackageManager(environment), undefined)
})

test('reports absent Bash without invoking it and detects incompatible flags', shell, () => {
  const result = spawnSync(sh, ['-c', `PATH=/nonexistent
find() { if [ "$1" = --version ]; then printf "GNU find\\n"; else return 1; fi; }
${capabilityProbe(['bash', 'find', 'tar'])}`], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'LINUX_NEXUS_CAPABILITY:missing:bash\nLINUX_NEXUS_CAPABILITY:incompatible:find\nLINUX_NEXUS_CAPABILITY:missing:tar\n')
})

test('connection script gathers login UID and capability report without external commands', shell, () => {
  const result = spawnSync(sh, ['-s'], { input: `PATH=/nonexistent
${buildEnvironmentProbe()
  .replace(/^if \[ -r \/proc\/sys\/kernel\/ostype \].*$/m, 'kernel=Linux')
  .replace(/if \[ -r \/proc\/self\/status \]; then[\s\S]+?done < \/proc\/self\/status\nfi/, 'uid=1000')}
`, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const [uid, , capabilities] = result.stdout.split('\0')
  assert.equal(uid, '1000')
  assert.deepEqual(capabilities.trim().split('\n'), baseCapabilities.map(tool => 'LINUX_NEXUS_CAPABILITY:missing:' + tool))
})

test('supports Linux environments where proc is not mounted but uname and id are available', shell, () => {
  const input = `uname() { printf 'Linux\\n'; }
id() { printf '1001\\n'; }
${buildEnvironmentProbe().replaceAll('/proc/', '/nonexistent-proc/')}`
  const result = spawnSync(sh, ['-s'], { input, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.split('\0')[0], '1001')
})

test('text and archive preflight stop before the operation writes', shell, () => {
  for (const tool of ['getfacl', 'unzip', 'zstd'] as const) {
    const result = spawnSync(sh, ['-c', `PATH=/nonexistent\n${requireCapabilities([tool])}\nprintf 'operation wrote data'`], { encoding: 'utf8' })
    assert.equal(result.status, 74)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, 'LINUX_NEXUS_CAPABILITY:missing:' + tool + '\n')
  }
})
