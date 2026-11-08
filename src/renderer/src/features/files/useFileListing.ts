import { type MessageValue, msg, renderMessage } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useMemo } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { FileViewMode, SessionTab, SortColumn, SortDirection } from '@/app-types'
import { entryNameCollator } from '@/app-utils'
import type { Breadcrumb } from './FilePathBar'

const entryTypeLabels: Record<RemoteEntry['type'], MessageValue> = {
  directory: msg('files.folder'),
  file: msg('files.file'),
  symlink: msg('files.symbolicLink'),
  other: msg('files.other'),
}

function getEntryTypeExtension(name: string): string {
  const extensionStart = name.lastIndexOf('.')
  return extensionStart > 0 && extensionStart < name.length - 1
    ? name.slice(extensionStart + 1).toLowerCase()
    : ''
}

interface UseFileListingOptions {
  activeSession: SessionTab | null
  viewModeDefault: FileViewMode
  patchSession: (sessionId: string, patch: Partial<SessionTab>) => void
}

export function useFileListing({ activeSession, viewModeDefault, patchSession }: UseFileListingOptions) {
  const language = useLanguage()
  const currentPath = activeSession?.currentPath ?? '/'
  const entries = activeSession?.entries ?? []
  const loading = activeSession?.loading ?? false
  const viewMode = activeSession?.viewMode ?? viewModeDefault
  const sort = activeSession?.sort ?? { column: 'name' as SortColumn, direction: 'ascending' as SortDirection }
  const highlightedPath = activeSession?.highlightedPath ?? null

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean)
    const items: Breadcrumb[] = [{ label: '/', path: '/' }]
    let path = ''
    for (const part of parts) {
      path += `/${part}`
      items.push({ label: part, path })
    }
    return items
  }, [currentPath])

  const sortedEntries = useMemo(() => [...entries].sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1
    if (left.type !== 'directory' && right.type === 'directory') return 1

    let comparison = 0
    if (sort.column === 'name') {
      comparison = entryNameCollator.compare(left.name, right.name)
    } else if (sort.column === 'size') {
      comparison = left.type === 'directory' ? 0 : left.size - right.size
    } else if (sort.column === 'type') {
      comparison = entryNameCollator.compare(renderMessage(entryTypeLabels[left.type]), renderMessage(entryTypeLabels[right.type]))
      if (comparison === 0 && left.type === 'file' && right.type === 'file') {
        comparison = entryNameCollator.compare(getEntryTypeExtension(left.name), getEntryTypeExtension(right.name))
      }
    } else if (sort.column === 'modifiedAt') {
      if (left.modifiedAt === null || right.modifiedAt === null) {
        if (left.modifiedAt === null && right.modifiedAt !== null) return 1
        if (left.modifiedAt !== null && right.modifiedAt === null) return -1
      } else {
        comparison = Date.parse(left.modifiedAt) - Date.parse(right.modifiedAt)
      }
    } else {
      comparison = entryNameCollator.compare(left.permissions, right.permissions)
    }

    if (comparison === 0) return entryNameCollator.compare(left.name, right.name)
    return sort.direction === 'ascending' ? comparison : -comparison
  }), [entries, sort, language])

  const toggleSort = (column: SortColumn) => {
    if (!activeSession || activeSession.kind !== 'files') return
    patchSession(activeSession.id, {
      sort: activeSession.sort.column === column
        ? { column, direction: activeSession.sort.direction === 'ascending' ? 'descending' : 'ascending' }
        : { column, direction: 'ascending' },
    })
  }

  return { currentPath, entries, loading, viewMode, sort, highlightedPath, breadcrumbs, sortedEntries, toggleSort }
}
