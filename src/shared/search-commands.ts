import type { ContentSearchRequest, NameSearchRequest } from './types'
import { shellQuote } from './shell'
import { buildContentSearchScript } from './content-search-script'

function escapeFindPattern(value: string): string {
  return value.replace(/[\\*?\[\]]/g, '\\$&')
}

export function buildNameSearchCommand(request: Pick<NameSearchRequest, 'rootPath' | 'query' | 'matchMode' | 'ignoreCase'>): string {
  const literal = escapeFindPattern(request.query)
  const pattern = request.matchMode === 'contains' ? `*${literal}*` : literal
  const matcher = request.ignoreCase ? '-iname' : '-name'
  return [
    'find --',
    shellQuote(request.rootPath),
    '-type f',
    matcher,
    shellQuote(pattern),
    '-print0',
  ].join(' ')
}

export function buildContentSearchCommand(request: Pick<ContentSearchRequest, 'rootPath' | 'query' | 'ignoreCase' | 'maxFileSizeMiB'>): string {
  return 'bash -c ' + shellQuote(buildContentSearchScript()) + ' linux-nexus-content-search'
    + ' ' + [request.rootPath, request.query, request.ignoreCase ? '1' : '0', String(request.maxFileSizeMiB * 1024 * 1024)]
      .map(shellQuote).join(' ')
}
