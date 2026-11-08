import { type MessageValue, msg, renderMessage, tr } from '@shared/i18n/messages'
import type { FileTypeExtensions, RemoteEntry, SearchResultTarget } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { classifyFileTypeCategories, fileTypeDefinition } from '@shared/file-type-registry'
import { previewTypesForFile, previewTypeLabels } from '@shared/preview-file-type'
import { archiveBaseName, archiveFormatForName } from '@shared/archive'
import type { SortColumn, SortDirection } from '@/app-types'
import type { OperationExecutionStrategy, PasteStrategy } from '@shared/types'

export type FileMenuIcon =
  | 'arrow-down'
  | 'arrow-up'
  | 'arrow-up-down'
  | 'archive'
  | 'check'
  | 'clipboard-paste'
  | 'copy'
  | 'eye'
  | 'file-text'
  | 'folder-open'
  | 'folder-plus'
  | 'info'
  | 'pencil'
  | 'play'
  | 'scissors'
  | 'terminal'
  | 'trash'
  | 'upload'

export type FileMenuAction =
  | { type: 'preview'; previewType: PreviewType }
  | { type: 'preview-log' }
  | { type: 'extract-archive'; target: 'current-directory' | 'archive-directory' | 'choose-directory'; strategy: OperationExecutionStrategy }
  | { type: 'run-script' }
  | { type: 'adjust-script-command' }
  | { type: 'download' }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste'; strategy: PasteStrategy }
  | { type: 'copy-path' }
  | { type: 'rename' }
  | { type: 'delete' }
  | { type: 'sort-column'; column: SortColumn }
  | { type: 'sort-direction'; direction: SortDirection }
  | { type: 'create-directory' }
  | { type: 'upload'; strategy: PasteStrategy }
  | { type: 'open-location' }
  | { type: 'properties' }

export type FileMenuActionNode = {
  kind: 'action'
  id: string
  label: MessageValue
  icon?: FileMenuIcon
  action: FileMenuAction
  disabled?: boolean
  disabledReason?: MessageValue
  description?: MessageValue
  checked?: boolean
}

export type FileMenuNode = FileMenuActionNode
  | { kind: 'submenu'; id: string; label: MessageValue; icon: FileMenuIcon; children: FileMenuNode[]; disabled?: boolean; disabledReason?: MessageValue }
  | { kind: 'separator'; id: string }

export type FileContextMenuContext =
  | { kind: 'single-entry'; entry: RemoteEntry; canPaste: boolean }
  | { kind: 'multiple-entries'; entries: RemoteEntry[]; canPaste: boolean }
  | { kind: 'directory-background'; directory: string; canPaste: boolean; sort: { column: SortColumn; direction: SortDirection } }
  | { kind: 'search-result'; result: SearchResultTarget }

export interface FileContextMenuStrategy {
  readonly id: string
  readonly group: 'specialized' | 'common'
  matches(context: FileContextMenuContext, fileTypeExtensions: FileTypeExtensions): boolean
  contribute(context: FileContextMenuContext, fileTypeExtensions: FileTypeExtensions): FileMenuNode[]
}

const action = (
  id: string,
  label: MessageValue,
  icon: FileMenuIcon | undefined,
  menuAction: FileMenuAction,
  options: Pick<FileMenuActionNode, 'disabled' | 'disabledReason' | 'description' | 'checked'> = {},
): FileMenuActionNode => ({ kind: 'action', id, label, icon, action: menuAction, ...options })

const overwriteAndSkipStrategies: Array<{ strategy: PasteStrategy; label: MessageValue; description: MessageValue }> = [
  { strategy: 'force', label: msg('files.overwriteExistingFiles'), description: msg('files.replaceFilesWithTheSameNameAtTheDestination') },
  { strategy: 'skip', label: msg('files.skipExistingFiles'), description: msg('files.keepExistingFilesAndProcessTheRemainingFiles') },
]

function pasteStrategyMenu(disabled: boolean): FileMenuNode {
  return {
    kind: 'submenu',
    id: 'paste-strategy',
    label: tr('connections.paste'),
    icon: 'clipboard-paste',
    disabled,
    disabledReason: disabled ? tr('files.cannotPasteHere') : undefined,
    children: overwriteAndSkipStrategies.map(({ strategy, label, description }) => action(
      'paste-' + strategy,
      label,
      undefined,
      { type: 'paste', strategy },
      { disabled, disabledReason: disabled ? tr('files.cannotPasteHere') : undefined, description },
    )),
  }
}

function uploadStrategyMenu(): FileMenuNode {
  return {
    kind: 'submenu',
    id: 'upload-strategy',
    label: tr('transfers.upload'),
    icon: 'upload',
    children: overwriteAndSkipStrategies.map(({ strategy, label, description }) => action(
      'upload-' + strategy,
      label,
      undefined,
      { type: 'upload', strategy },
      { description },
    )),
  }
}

function fileForContext(context: FileContextMenuContext): Pick<RemoteEntry, 'name' | 'path' | 'type'> | null {
  if (context.kind === 'single-entry') return context.entry
  if (context.kind === 'search-result') return context.result
  return null
}

function matchingCapabilities(context: FileContextMenuContext, fileTypeExtensions: FileTypeExtensions) {
  const entry = fileForContext(context)
  if (!entry || entry.type !== 'file') return new Set()
  return new Set(classifyFileTypeCategories(entry.name, fileTypeExtensions)
    .flatMap((category) => fileTypeDefinition(category).menuCapabilities))
}

const previewStrategy: FileContextMenuStrategy = {
  id: 'file-previews',
  group: 'specialized',
  matches(context, fileTypeExtensions) {
    const entry = fileForContext(context)
    return Boolean(entry?.type === 'file' && previewTypesForFile(entry.name, fileTypeExtensions).length)
  },
  contribute(context, fileTypeExtensions) {
    const entry = fileForContext(context)
    if (!entry || entry.type !== 'file') return []
    const types = previewTypesForFile(entry.name, fileTypeExtensions)
    if (types.length === 1) return [action('preview', tr('files.preview'), 'eye', { type: 'preview', previewType: types[0] })]
    return [{
      kind: 'submenu',
      id: 'preview',
      label: tr('files.preview'),
      icon: 'eye',
      children: types.map((previewType) => action(
        'preview-' + previewType,
        renderMessage(previewTypeLabels[previewType]),
        'eye',
        { type: 'preview', previewType },
      )),
    }]
  },
}

const reversePreviewStrategy: FileContextMenuStrategy = {
  id: 'reverse-preview',
  group: 'specialized',
  matches(context, fileTypeExtensions) {
    return matchingCapabilities(context, fileTypeExtensions).has('reverse-preview')
  },
  contribute() {
    return [action('preview-log', tr('files.reversePreview'), 'file-text', { type: 'preview-log' })]
  },
}

const scriptExecutionStrategy: FileContextMenuStrategy = {
  id: 'script-execution',
  group: 'specialized',
  matches(context, fileTypeExtensions) {
    return matchingCapabilities(context, fileTypeExtensions).has('script-execution')
  },
  contribute() {
    return [{
      kind: 'submenu',
      id: 'script-execution',
      label: tr('files.run'),
      icon: 'terminal',
      children: [
        action('run-script', tr('files.run'), 'play', { type: 'run-script' }),
        action('adjust-run-script', tr('files.editAndRun'), 'pencil', { type: 'adjust-script-command' }),
      ],
    }]
  },
}

const archiveExtractionStrategy: FileContextMenuStrategy = {
  id: 'archive-extraction',
  group: 'specialized',
  matches(context) {
    const entry = fileForContext(context)
    return Boolean(entry?.type === 'file' && archiveFormatForName(entry.name))
  },
  contribute(context) {
    const entry = fileForContext(context)
    if (!entry) return []
    const destinations = [
      { target: 'current-directory' as const, id: 'current-directory', label: tr('files.currentPath') },
      { target: 'archive-directory' as const, id: 'archive-directory', label: archiveBaseName(entry.name) + '/' },
      { target: 'choose-directory' as const, id: 'choose-directory', label: tr('files.chooseDirectory') },
    ]
    return [{
      kind: 'submenu',
      id: 'extract-archive',
      label: tr('common.extract'),
      icon: 'archive',
      children: destinations.flatMap((destination, index) => [
        ...(index ? [{ kind: 'separator' as const, id: 'extract-' + destination.id + '-separator' }] : []),
        ...overwriteAndSkipStrategies.map(({ strategy, label }) => action(
          'extract-' + destination.id + '-' + strategy,
          msg('common.destinationAction', { destination: destination.label, action: label }),
          undefined,
          { type: 'extract-archive', target: destination.target, strategy },
        )),
      ]),
    }]
  },
}

const singleEntryStrategy: FileContextMenuStrategy = {
  id: 'single-entry-common',
  group: 'common',
  matches: (context) => context.kind === 'single-entry',
  contribute(context) {
    if (context.kind !== 'single-entry') return []
    const { entry } = context
    if (entry.type !== 'file' && entry.type !== 'directory') {
      return [action('copy-path', tr('files.copyPath'), 'copy', { type: 'copy-path' })]
    }
    const isDirectory = entry.type === 'directory'
    return [
      action('download', isDirectory ? tr('files.downloadFolder') : tr('files.downloadFile'), 'arrow-down', { type: 'download' }),
      action('copy', tr('common.copy'), 'copy', { type: 'copy' }),
      action('cut', tr('files.cut'), 'scissors', { type: 'cut' }),
      pasteStrategyMenu(!context.canPaste),
      action('copy-path', tr('files.copyPath'), 'copy', { type: 'copy-path' }),
      action('rename', tr('files.rename'), 'pencil', { type: 'rename' }),
      action('delete', tr('files.delete'), 'trash', { type: 'delete' }),
    ]
  },
}

const multipleEntriesStrategy: FileContextMenuStrategy = {
  id: 'multiple-entries-common',
  group: 'common',
  matches: (context) => context.kind === 'multiple-entries',
  contribute(context) {
    if (context.kind !== 'multiple-entries') return []
    const { entries } = context
    const count = entries.length
    const allEntriesSupported = entries.every((entry) => entry.type === 'file' || entry.type === 'directory')
    const nodes: FileMenuNode[] = []
    if (allEntriesSupported) {
      nodes.push(
        action('download', tr('files.downloadItems', { "count": count }), 'arrow-down', { type: 'download' }),
        action('copy', tr('files.copyItems', { "count": count }), 'copy', { type: 'copy' }),
        action('cut', tr('files.cutItems', { "count": count }), 'scissors', { type: 'cut' }),
      )
    }
    nodes.push(pasteStrategyMenu(!context.canPaste))
    if (allEntriesSupported) nodes.push(action('delete', tr('files.deleteItems', { "count": count }), 'trash', { type: 'delete' }))
    return nodes
  },
}

const sortColumns: { column: SortColumn; label: MessageValue }[] = [
  { column: 'name', label: msg('common.name') },
  { column: 'modifiedAt', label: msg('files.dateModified') },
  { column: 'type', label: msg('files.type') },
  { column: 'size', label: msg('files.size') },
  { column: 'permissions', label: msg('files.permissions') },
]

const directoryBackgroundStrategy: FileContextMenuStrategy = {
  id: 'directory-background-common',
  group: 'common',
  matches: (context) => context.kind === 'directory-background',
  contribute(context) {
    if (context.kind !== 'directory-background') return []
    return [
      {
        kind: 'submenu',
        id: 'sort',
        label: tr('files.sortBy'),
        icon: 'arrow-up-down',
        children: [
          ...sortColumns.map(({ column, label }) => action(
            'sort-' + column,
            label,
            context.sort.column === column ? 'check' : undefined,
            { type: 'sort-column', column },
            { checked: context.sort.column === column },
          )),
          { kind: 'separator', id: 'sort-direction-separator' },
          action('sort-ascending', tr('files.ascending'), context.sort.direction === 'ascending' ? 'check' : undefined, { type: 'sort-direction', direction: 'ascending' }, {
            checked: context.sort.direction === 'ascending',
          }),
          action('sort-descending', tr('files.descending'), context.sort.direction === 'descending' ? 'check' : undefined, { type: 'sort-direction', direction: 'descending' }, {
            checked: context.sort.direction === 'descending',
          }),
        ],
      },
      action('copy-path', tr('files.copyPath'), 'copy', { type: 'copy-path' }),
      pasteStrategyMenu(!context.canPaste),
      action('create-directory', tr('common.newFolder'), 'folder-plus', { type: 'create-directory' }),
      uploadStrategyMenu(),
    ]
  },
}

const searchResultStrategy: FileContextMenuStrategy = {
  id: 'search-result-common',
  group: 'common',
  matches: (context) => context.kind === 'search-result',
  contribute(context) {
    if (context.kind !== 'search-result') return []
    return [action('open-location', tr('files.openContainingDirectory'), 'folder-open', { type: 'open-location' })]
  },
}

const entryPropertiesStrategy: FileContextMenuStrategy = {
  id: 'entry-properties',
  group: 'common',
  matches: (context) => context.kind === 'single-entry' || context.kind === 'search-result',
  contribute: () => [action('properties', tr('files.properties'), 'info', { type: 'properties' })],
}

export const fileContextMenuStrategies: readonly FileContextMenuStrategy[] = [
  previewStrategy,
  reversePreviewStrategy,
  scriptExecutionStrategy,
  archiveExtractionStrategy,
  singleEntryStrategy,
  multipleEntriesStrategy,
  directoryBackgroundStrategy,
  searchResultStrategy,
  entryPropertiesStrategy,
]

export function resolveFileContextMenu(context: FileContextMenuContext, fileTypeExtensions: FileTypeExtensions): FileMenuNode[] {
  const specialized: FileMenuNode[] = []
  const common: FileMenuNode[] = []
  for (const strategy of fileContextMenuStrategies) {
    if (!strategy.matches(context, fileTypeExtensions)) continue
    const destination = strategy.group === 'specialized' ? specialized : common
    destination.push(...strategy.contribute(context, fileTypeExtensions))
  }
  if (specialized.length && common.length) specialized.push({ kind: 'separator', id: 'specialized-common-separator' })
  return [...specialized, ...common]
}
