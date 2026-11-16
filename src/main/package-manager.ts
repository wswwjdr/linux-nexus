import { posixCommand, type Capability, type Manager, type ServerEnvironment } from './server-capabilities.ts'

export interface PackageManagerStrategy {
  manager: Manager
  families: readonly string[]
  packages: Readonly<Partial<Record<Capability, string>>>
  install: (packages: readonly string[]) => string
}

const packageNames = {
  bash: 'bash', cat: 'coreutils', cp: 'coreutils', mv: 'coreutils', rm: 'coreutils', mkdir: 'coreutils',
  rmdir: 'coreutils', sha256sum: 'coreutils', dd: 'coreutils', head: 'coreutils',
  mktemp: 'coreutils', stat: 'coreutils', touch: 'coreutils', readlink: 'coreutils',
  du: 'coreutils', base64: 'coreutils', dirname: 'coreutils', basename: 'coreutils',
  find: 'findutils', grep: 'grep', tar: 'tar', awk: 'gawk', sed: 'sed',
  getfacl: 'acl', getfattr: 'attr', unzip: 'unzip', gzip: 'gzip', bzip2: 'bzip2', xz: 'xz', zstd: 'zstd',
} satisfies Record<Capability, string>
const rpmFamilies = ['rhel', 'centos', 'fedora', 'rocky', 'almalinux', 'ol']

/**
 * Creates an installer strategy for a verified manager.
 * @param manager Executable name under /usr/bin.
 * @param families Distribution identities or families that use this strategy.
 * @param flags Fixed options to pass before the install subcommand.
 * @param packages Mapping from missing capabilities to packages shipped for these families.
 * @returns The strategy for selecting and invoking the installer.
 */
function strategy(manager: Manager, families: string[], flags: string[], packages: PackageManagerStrategy['packages']): PackageManagerStrategy {
  return {
    manager, families, packages,
    install: names => posixCommand([
      'PATH=/usr/sbin:/usr/bin:/sbin:/bin',
      'export PATH LC_ALL=C DEBIAN_FRONTEND=noninteractive',
      'exec "$@"',
    ].join('\n'), ['/usr/bin/' + manager, ...flags, 'install', ...names]),
  }
}

const strategies = [
  strategy('apt-get', ['debian', 'ubuntu'], ['-y', '--no-install-recommends', '--no-remove'], packageNames),
  strategy('dnf', rpmFamilies, ['-y'], packageNames),
  // zstd is not part of the standard CentOS 7 repositories.
  strategy('yum', rpmFamilies, ['-y'], { ...packageNames, zstd: undefined }),
]

/** Returns a verified strategy for the given `environment`, preferring dnf over yum on the same family. */
export function selectPackageManager(environment: ServerEnvironment): PackageManagerStrategy | undefined {
  const { id, like } = environment.distribution
  const candidates = strategies.filter(value => environment.managers.includes(value.manager)
    && value.families.some(family => family === id || like.includes(family)))
  const apt = candidates.find(value => value.manager === 'apt-get')
  const rpm = candidates.find(value => value.manager !== 'apt-get')
  return apt && rpm ? undefined : apt ?? rpm
}
