import type { FileTypeExtensions, RemoteEntry, SearchResultTarget } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { classifyFileTypeCategories, fileTypeDefinition } from '@shared/file-type-registry'
import { previewTypesForFile, previewTypeLabels } from '@shared/preview-file-type'
import type { SortColumn, SortDirection } from '@/app-types'

export type SftpMenuIcon =
  | 'arrow-down'
  | 'arrow-up'
  | 'arrow-up-down'
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

export type SftpMenuAction =
  | { type: 'preview'; previewType: PreviewType }
  | { type: 'preview-log' }
  | { type: 'run-script' }
  | { type: 'adjust-script-command' }
  | { type: 'download' }
  | { type: 'copy' }
  | { type: 'cut' }
  | { type: 'paste' }
  | { type: 'copy-path' }
  | { type: 'delete' }
  | { type: 'sort-column'; column: SortColumn }
  | { type: 'sort-direction'; direction: SortDirection }
  | { type: 'create-directory' }
  | { type: 'upload' }
  | { type: 'open-location' }

export type SftpMenuActionNode = {
  kind: 'action'
  id: string
  label: string
  icon: SftpMenuIcon
  action: SftpMenuAction
  disabled?: boolean
  disabledReason?: string
  checked?: boolean
}

export type SftpMenuNode = SftpMenuActionNode
  | { kind: 'submenu'; id: string; label: string; icon: SftpMenuIcon; children: SftpMenuActionNode[] }
  | { kind: 'separator'; id: string }

export type SftpContextMenuContext =
  | { kind: 'single-entry'; entry: RemoteEntry; canPaste: boolean }
  | { kind: 'multiple-entries'; entries: RemoteEntry[]; canPaste: boolean }
  | { kind: 'directory-background'; directory: string; canPaste: boolean; sort: { column: SortColumn; direction: SortDirection } }
  | { kind: 'search-result'; result: SearchResultTarget }

export interface SftpContextMenuStrategy {
  readonly id: string
  readonly group: 'specialized' | 'common'
  matches(context: SftpContextMenuContext, fileTypeExtensions: FileTypeExtensions): boolean
  contribute(context: SftpContextMenuContext, fileTypeExtensions: FileTypeExtensions): SftpMenuNode[]
}

const action = (
  id: string,
  label: string,
  icon: SftpMenuIcon,
  menuAction: SftpMenuAction,
  options: Pick<SftpMenuActionNode, 'disabled' | 'disabledReason' | 'checked'> = {},
): SftpMenuActionNode => ({ kind: 'action', id, label, icon, action: menuAction, ...options })

function fileForContext(context: SftpContextMenuContext): Pick<RemoteEntry, 'name' | 'path' | 'type'> | null {
  if (context.kind === 'single-entry') return context.entry
  if (context.kind === 'search-result') return context.result
  return null
}

function matchingCapabilities(context: SftpContextMenuContext, fileTypeExtensions: FileTypeExtensions) {
  const entry = fileForContext(context)
  if (!entry || entry.type !== 'file') return new Set()
  return new Set(classifyFileTypeCategories(entry.name, fileTypeExtensions)
    .flatMap((category) => fileTypeDefinition(category).menuCapabilities))
}

const previewStrategy: SftpContextMenuStrategy = {
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

const reversePreviewStrategy: SftpContextMenuStrategy = {
  id: 'reverse-preview',
  group: 'specialized',
  matches(context, fileTypeExtensions) {
    return matchingCapabilities(context, fileTypeExtensions).has('reverse-preview')
  },
  contribute() {
    return [action('preview-log', '倒序预览', 'file-text', { type: 'preview-log' })]
  },
}

const scriptExecutionStrategy: SftpContextMenuStrategy = {
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

const singleEntryStrategy: SftpContextMenuStrategy = {
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
      action('paste', isDirectory ? '粘贴到文件夹' : '粘贴到当前目录', 'clipboard-paste', { type: 'paste' }, {
        disabled: !context.canPaste,
        disabledReason: context.canPaste ? undefined : '剪贴板为空',
      }),
      action('copy-path', '复制路径', 'copy', { type: 'copy-path' }),
      action('delete', '删除', 'trash', { type: 'delete' }),
    ]
  },
}

const multipleEntriesStrategy: SftpContextMenuStrategy = {
  id: 'multiple-entries-common',
  group: 'common',
  matches: (context) => context.kind === 'multiple-entries',
  contribute(context) {
    if (context.kind !== 'multiple-entries') return []
    const { entries } = context
    const count = entries.length
    const allEntriesSupported = entries.every((entry) => entry.type === 'file' || entry.type === 'directory')
    const nodes: SftpMenuNode[] = []
    if (allEntriesSupported) {
      nodes.push(
        action('download', `下载 ${count} 项`, 'arrow-down', { type: 'download' }),
        action('copy', `复制 ${count} 项`, 'copy', { type: 'copy' }),
        action('cut', `剪切 ${count} 项`, 'scissors', { type: 'cut' }),
      )
    }
    nodes.push(action('paste', '粘贴到当前目录', 'clipboard-paste', { type: 'paste' }, {
      disabled: !context.canPaste,
      disabledReason: context.canPaste ? undefined : '剪贴板为空',
    }))
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

const directoryBackgroundStrategy: SftpContextMenuStrategy = {
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
            context.sort.column === column ? 'check' : 'arrow-up-down',
            { type: 'sort-column', column },
            { checked: context.sort.column === column },
          )),
          action('sort-ascending', '递增', 'arrow-up', { type: 'sort-direction', direction: 'ascending' }, {
            checked: context.sort.direction === 'ascending',
          }),
          action('sort-descending', '递减', 'arrow-down', { type: 'sort-direction', direction: 'descending' }, {
            checked: context.sort.direction === 'descending',
          }),
        ],
      },
      action('copy-path', '复制路径', 'copy', { type: 'copy-path' }),
      action('paste', '粘贴', 'clipboard-paste', { type: 'paste' }, {
        disabled: !context.canPaste,
        disabledReason: context.canPaste ? undefined : '剪贴板为空',
      }),
      action('create-directory', '新建文件夹', 'folder-plus', { type: 'create-directory' }),
      action('upload', '上传', 'upload', { type: 'upload' }),
    ]
  },
}

const searchResultStrategy: SftpContextMenuStrategy = {
  id: 'search-result-common',
  group: 'common',
  matches: (context) => context.kind === 'search-result',
  contribute(context) {
    if (context.kind !== 'search-result') return []
    return [action('open-location', '打开所在目录', 'folder-open', { type: 'open-location' })]
  },
}

export const sftpContextMenuStrategies: readonly SftpContextMenuStrategy[] = [
  previewStrategy,
  reversePreviewStrategy,
  scriptExecutionStrategy,
  singleEntryStrategy,
  multipleEntriesStrategy,
  directoryBackgroundStrategy,
  searchResultStrategy,
]

export function resolveSftpContextMenu(context: SftpContextMenuContext, fileTypeExtensions: FileTypeExtensions): SftpMenuNode[] {
  const specialized: SftpMenuNode[] = []
  const common: SftpMenuNode[] = []
  for (const strategy of sftpContextMenuStrategies) {
    if (!strategy.matches(context, fileTypeExtensions)) continue
    const destination = strategy.group === 'specialized' ? specialized : common
    destination.push(...strategy.contribute(context, fileTypeExtensions))
  }
  if (specialized.length && common.length) specialized.push({ kind: 'separator', id: 'specialized-common-separator' })
  return [...specialized, ...common]
}
