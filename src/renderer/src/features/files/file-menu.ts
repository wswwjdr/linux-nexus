import type { FileTypeExtensions, RemoteEntry, SearchResultTarget } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { classifyFileTypeCategories, fileTypeDefinition } from '@shared/file-type-registry'
import { previewTypesForFile, previewTypeLabels } from '@shared/preview-file-type'
import { archiveBaseName, archiveFormatForName } from '@shared/archive'
import type { SortColumn, SortDirection } from '@/app-types'
import type { OperationExecutionStrategy, OperationStrategy, PasteStrategy } from '@shared/types'

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
  | { type: 'upload'; strategy: OperationStrategy }
  | { type: 'open-location' }

export type FileMenuActionNode = {
  kind: 'action'
  id: string
  label: string
  icon?: FileMenuIcon
  action: FileMenuAction
  disabled?: boolean
  disabledReason?: string
  description?: string
  checked?: boolean
}

export type FileMenuNode = FileMenuActionNode
  | { kind: 'submenu'; id: string; label: string; icon: FileMenuIcon; children: FileMenuNode[]; disabled?: boolean; disabledReason?: string }
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
  label: string,
  icon: FileMenuIcon | undefined,
  menuAction: FileMenuAction,
  options: Pick<FileMenuActionNode, 'disabled' | 'disabledReason' | 'description' | 'checked'> = {},
): FileMenuActionNode => ({ kind: 'action', id, label, icon, action: menuAction, ...options })

const executionStrategies: Array<{ strategy: OperationExecutionStrategy; label: string; description: string }> = [
  { strategy: 'force', label: '覆盖同名文件', description: '遇到同名文件时覆盖；权限和目录结构限制仍然生效。' },
  { strategy: 'skip', label: '跳过同名文件', description: '保留目标目录中的同名文件，继续处理其他文件。' },
  { strategy: 'update', label: '仅更新较旧文件', description: '目标不存在，或来源的修改时间晚于目标时才处理。' },
]

const pasteStrategies: Array<{ strategy: PasteStrategy; label: string; description: string }> = executionStrategies
  .filter((item): item is typeof item & { strategy: PasteStrategy } => item.strategy !== 'update')

const uploadStrategies: Array<{ strategy: OperationStrategy; label: string; description: string }> = [
  ...executionStrategies,
  { strategy: 'confirm', label: '确认后上传', description: '上传前确认内容，并选择覆盖或跳过同名文件。' },
]

function pasteStrategyMenu(disabled: boolean): FileMenuNode {
  return {
    kind: 'submenu',
    id: 'paste-strategy',
    label: '粘贴',
    icon: 'clipboard-paste',
    disabled,
    disabledReason: disabled ? '当前无法粘贴' : undefined,
    children: pasteStrategies.map(({ strategy, label, description }) => action(
      'paste-' + strategy,
      label,
      undefined,
      { type: 'paste', strategy },
      { disabled, disabledReason: disabled ? '当前无法粘贴' : undefined, description },
    )),
  }
}

function uploadStrategyMenu(): FileMenuNode {
  return {
    kind: 'submenu',
    id: 'upload-strategy',
    label: '上传',
    icon: 'upload',
    children: uploadStrategies.map(({ strategy, label }) => action(
      'upload-' + strategy,
      label,
      undefined,
      { type: 'upload', strategy },
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
    if (types.length === 1) return [action('preview', '预览', 'eye', { type: 'preview', previewType: types[0] })]
    return [{
      kind: 'submenu',
      id: 'preview',
      label: '预览',
      icon: 'eye',
      children: types.map((previewType) => action(
        'preview-' + previewType,
        previewTypeLabels[previewType],
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
    return [action('preview-log', '倒序预览', 'file-text', { type: 'preview-log' })]
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
      label: '执行',
      icon: 'terminal',
      children: [
        action('run-script', '执行', 'play', { type: 'run-script' }),
        action('adjust-run-script', '调整并执行', 'pencil', { type: 'adjust-script-command' }),
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
      { target: 'current-directory' as const, id: 'current-directory', label: '当前路径' },
      { target: 'archive-directory' as const, id: 'archive-directory', label: archiveBaseName(entry.name) + '/' },
      { target: 'choose-directory' as const, id: 'choose-directory', label: '选择目录' },
    ]
    return [{
      kind: 'submenu',
      id: 'extract-archive',
      label: '解压',
      icon: 'archive',
      children: destinations.flatMap((destination, index) => [
        ...(index ? [{ kind: 'separator' as const, id: 'extract-' + destination.id + '-separator' }] : []),
        ...executionStrategies.map(({ strategy, label }) => action(
          'extract-' + destination.id + '-' + strategy,
          destination.label + ' · ' + label,
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
      return [action('copy-path', '复制路径', 'copy', { type: 'copy-path' })]
    }
    const isDirectory = entry.type === 'directory'
    return [
      action('download', isDirectory ? '下载文件夹' : '下载文件', 'arrow-down', { type: 'download' }),
      action('copy', '复制', 'copy', { type: 'copy' }),
      action('cut', '剪切', 'scissors', { type: 'cut' }),
      pasteStrategyMenu(!context.canPaste),
      action('copy-path', '复制路径', 'copy', { type: 'copy-path' }),
      action('rename', '重命名', 'pencil', { type: 'rename' }),
      action('delete', '删除', 'trash', { type: 'delete' }),
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
        action('download', `下载 ${count} 项`, 'arrow-down', { type: 'download' }),
        action('copy', `复制 ${count} 项`, 'copy', { type: 'copy' }),
        action('cut', `剪切 ${count} 项`, 'scissors', { type: 'cut' }),
      )
    }
    nodes.push(pasteStrategyMenu(!context.canPaste))
    if (allEntriesSupported) nodes.push(action('delete', `删除 ${count} 项`, 'trash', { type: 'delete' }))
    return nodes
  },
}

const sortColumns: { column: SortColumn; label: string }[] = [
  { column: 'name', label: '名称' },
  { column: 'modifiedAt', label: '修改日期' },
  { column: 'type', label: '类型' },
  { column: 'size', label: '大小' },
  { column: 'permissions', label: '权限' },
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
        label: '排序方式',
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
          action('sort-ascending', '递增', context.sort.direction === 'ascending' ? 'check' : undefined, { type: 'sort-direction', direction: 'ascending' }, {
            checked: context.sort.direction === 'ascending',
          }),
          action('sort-descending', '递减', context.sort.direction === 'descending' ? 'check' : undefined, { type: 'sort-direction', direction: 'descending' }, {
            checked: context.sort.direction === 'descending',
          }),
        ],
      },
      action('copy-path', '复制路径', 'copy', { type: 'copy-path' }),
      pasteStrategyMenu(!context.canPaste),
      action('create-directory', '新建文件夹', 'folder-plus', { type: 'create-directory' }),
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
    return [action('open-location', '打开所在目录', 'folder-open', { type: 'open-location' })]
  },
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
