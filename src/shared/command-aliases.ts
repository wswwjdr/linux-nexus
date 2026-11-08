import { msg, LocalizedError } from './i18n/messages'
import type { CommandAliasSnapshot, ServerProfile } from './types'

export interface ParsedCommandAlias {
  name: string
  command: string
  definition: string
  removable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function normalizeStoredCommandAliases(value: unknown, profileIds: ReadonlySet<string>): Record<string, CommandAliasSnapshot> {
  if (!isRecord(value)) throw new LocalizedError(msg('errors.invalidCommandAliasDataStructure'))
  const aliases = value
  for (const [profileId, candidate] of Object.entries(aliases)) {
    if (!profileIds.has(profileId) || !isRecord(candidate)
      || !hasExactKeys(candidate, ['profileId', 'aliases', 'syncedAt', 'status'])
      || candidate.profileId !== profileId || !Array.isArray(candidate.aliases)
      || (candidate.syncedAt !== null && (typeof candidate.syncedAt !== 'string' || !Number.isFinite(Date.parse(candidate.syncedAt))))
      || (candidate.status !== 'unsynced' && candidate.status !== 'synced' && candidate.status !== 'stale')
      || (candidate.status === 'synced' && candidate.syncedAt === null)) {
      throw new LocalizedError(msg('errors.invalidCommandAliasDataStructure2', { "profileId": profileId }))
    }
    const names = new Set<string>()
    for (const alias of candidate.aliases) {
      if (!isRecord(alias) || !hasExactKeys(alias, ['name', 'command', 'removable', 'removalReason'])
        || typeof alias.name !== 'string' || !alias.name
        || typeof alias.command !== 'string' || typeof alias.removable !== 'boolean'
        || (alias.removalReason !== null && typeof alias.removalReason !== 'string')
        || (alias.removable && alias.removalReason !== null)
        || (!alias.removable && !alias.removalReason)
        || names.has(alias.name)) {
        throw new LocalizedError(msg('errors.invalidCommandAliasDataStructure2', { "profileId": profileId }))
      }
      names.add(alias.name)
    }
  }
  return aliases as Record<string, CommandAliasSnapshot>
}

export function connectionIdentityChanged(previous: ServerProfile, next: ServerProfile): boolean {
  return previous.host !== next.host || previous.port !== next.port || previous.username !== next.username
}

export function validateCommandAlias(name: string, command: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new LocalizedError(msg('errors.aliasNamesMayContainOnlyLettersNumbersAndUnderscoresAnd'))
  }
  if (!command.trim() || command.length > 8192 || /[\0\r\n]/.test(command)) {
    throw new LocalizedError(msg('errors.commandMustNotBeEmptyOrContainLineBreaksOr'))
  }
}

export function formatBashAliasDefinition(name: string, command: string): string {
  validateCommandAlias(name, command)
  return `alias ${name}='${command.replace(/'/g, "'\\''")}'`
}

export function parseCommandAliasProtocol(output: string | Uint8Array, beginMarker: string, endMarker: string): ParsedCommandAlias[] {
  const text = typeof output === 'string' ? output : Buffer.from(output).toString('utf8')
  const fields = text.split('\0')
  const begin = fields.lastIndexOf(beginMarker)
  const end = fields.indexOf(endMarker, begin + 1)
  if (begin < 0 || end < 0 || (end - begin - 1) % 4 !== 0) {
    throw new LocalizedError(msg('errors.cannotReadServerCommandAliasData'))
  }

  const aliases: ParsedCommandAlias[] = []
  const names = new Set<string>()
  for (let index = begin + 1; index < end; index += 4) {
    const name = fields[index]
    const command = fields[index + 1]
    const definition = fields[index + 2]
    const removableValue = fields[index + 3]
    if (!name || command === undefined || definition === undefined
      || (removableValue !== '0' && removableValue !== '1') || names.has(name)) {
      throw new LocalizedError(msg('errors.serverReturnedInvalidCommandAliasData'))
    }
    names.add(name)
    aliases.push({ name, command, definition, removable: removableValue === '1' })
  }
  return aliases.sort((left, right) => left.name.localeCompare(right.name, 'en', { sensitivity: 'base' }))
}

export function countExactLines(contents: string, expectedLine: string): number {
  return contents.split(/\r?\n/).filter((line) => line === expectedLine).length
}
