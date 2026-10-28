import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import { AlertTriangle, File, LoaderCircle, Search } from 'lucide-react'
import type {
  ContentSearchEvent,
  ContentSearchProgress,
  ContentSearchRequest,
  ContentSearchResult,
  FileTypeExtensions,
  NameSearchEvent,
  NameSearchMatchMode,
  NameSearchProgress,
  NameSearchRequest,
  NameSearchResult,
  SearchResultTarget,
} from '@shared/types'
import FileContextMenu from '@/features/files/FileContextMenu'
import { SearchHistory, SearchScopeControl, type SearchScopeConditions, isNormalizedAbsoluteRemotePath, readSearchHistory } from './SearchShared'
import type { FileContextMenuContext, FileMenuAction } from '@/features/files/file-menu'
import { errorMessage, formatSize } from '@/app-utils'

export interface SearchPaneHandle {
  cancel: () => void
}

export interface SearchPaneProps {
  sessionId: string
  profileId: string
  currentPath: string
  active: boolean
  fileTypeExtensions: FileTypeExtensions
  onRunningChange: (running: boolean) => void
  onMenuOpenChange: (open: boolean) => void
  onMenuAction: (action: FileMenuAction, context: FileContextMenuContext) => void
}

export interface ResultMenuState {
  result: SearchResultTarget
  x: number
  y: number
  anchor: HTMLElement
}

export type NameConditions = SearchScopeConditions & {
  query: string
  matchMode: NameSearchMatchMode
  ignoreCase: boolean
}

export type ContentConditions = SearchScopeConditions & {
  query: string
  ignoreCase: boolean
  maxFileSizeMiB: number
}

export type SearchStatus = 'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

export const DEFAULT_MAX_FILE_SIZE_MIB = 100
export const MAX_QUERY_LENGTH = 4096
export const NAME_HISTORY_KEY = 'remote-files:name-search-history:v2:'
export const CONTENT_HISTORY_KEY = 'remote-files:content-search-history:v2:'

export function initialNameConditions(currentPath: string): NameConditions {
  return { query: '', matchMode: 'exact', ignoreCase: true, scope: 'current', rootPath: currentPath }
}

export function initialContentConditions(currentPath: string): ContentConditions {
  return { query: '', ignoreCase: true, maxFileSizeMiB: DEFAULT_MAX_FILE_SIZE_MIB, scope: 'current', rootPath: currentPath }
}

export function isNameConditions(value: unknown): value is NameConditions {
  if (!value || typeof value !== 'object') return false
  const conditions = value as Partial<NameConditions>
  return typeof conditions.query === 'string'
    && (conditions.matchMode === 'exact' || conditions.matchMode === 'contains')
    && typeof conditions.ignoreCase === 'boolean'
    && (conditions.scope === 'current' || conditions.scope === 'root' || conditions.scope === 'custom')
    && typeof conditions.rootPath === 'string'
}

export function isContentConditions(value: unknown): value is ContentConditions {
  if (!value || typeof value !== 'object') return false
  const conditions = value as Partial<ContentConditions>
  return typeof conditions.query === 'string'
    && typeof conditions.ignoreCase === 'boolean'
    && typeof conditions.maxFileSizeMiB === 'number'
    && Number.isInteger(conditions.maxFileSizeMiB)
    && conditions.maxFileSizeMiB >= 1
    && conditions.maxFileSizeMiB <= 102400
    && (conditions.scope === 'current' || conditions.scope === 'root' || conditions.scope === 'custom')
    && typeof conditions.rootPath === 'string'
}

export function emptyNameProgress(): NameSearchProgress {
  return { requestId: '', sessionId: '', profileId: '', elapsedMs: 0, matchedFiles: 0, incomplete: false, hasReadErrors: false }
}

export function emptyContentProgress(): ContentSearchProgress {
  return {
    requestId: '', sessionId: '', profileId: '', elapsedMs: 0, processedFiles: 0, processedBytes: 0,
    matchedFiles: 0, matchedLines: 0, skippedLargeFiles: 0, skippedBinaryFiles: 0, readErrors: 0,
    currentPath: null, incomplete: false,
  }
}

export function statusLabel(status: SearchStatus): string {
  return status === 'running' ? '正在搜索'
    : status === 'cancelling' ? '正在取消'
      : status === 'completed' ? '搜索完成'
        : status === 'cancelled' ? '搜索已取消'
          : status === 'failed' ? '搜索失败'
            : '等待开始'
}

export function historyScopeLabel(conditions: SearchScopeConditions): string {
  if (conditions.scope === 'root') return '系统根目录'
  if (conditions.scope === 'custom') return '自定义 · ' + conditions.rootPath
  return conditions.rootPath
}

export function ResultMenu({
  menu,
  anchorRef,
  fileTypeExtensions,
  onAction,
  onClose,
}: {
  menu: ResultMenuState | null
  anchorRef: RefObject<HTMLElement | null>
  fileTypeExtensions: FileTypeExtensions
  onAction: (action: FileMenuAction, context: FileContextMenuContext) => void
  onClose: () => void
}) {
  if (!menu) return null
  return (
    <FileContextMenu
      context={{ kind: 'search-result', result: menu.result }}
      position={{ x: menu.x, y: menu.y }}
      anchorRef={anchorRef}
      fileTypeExtensions={fileTypeExtensions}
      onAction={(action, context) => {
        onClose()
        onAction(action, context)
      }}
      onClose={onClose}
    />
  )
}

export function openMenu(event: ReactMouseEvent<HTMLButtonElement>, result: SearchResultTarget): ResultMenuState {
  const bounds = event.currentTarget.getBoundingClientRect()
  const pointerActivated = event.detail > 0
  return {
    result,
    x: pointerActivated ? event.clientX + 8 : bounds.right,
    y: pointerActivated ? event.clientY : bounds.top,
    anchor: event.currentTarget,
  }
}

export function NameVirtualResults({
  results,
  running,
  status,
  menu,
  onOpenMenu,
  onScroll,
}: {
  results: NameSearchResult[]
  running: boolean
  status: SearchStatus
  menu: ResultMenuState | null
  onOpenMenu: (event: ReactMouseEvent<HTMLButtonElement>, result: NameSearchResult) => void
  onScroll: () => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateHeight = () => setViewportHeight(viewport.clientHeight)
    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (results.length !== 0 || !viewportRef.current) return
    viewportRef.current.scrollTop = 0
    setScrollTop(0)
  }, [results.length])

  const rowHeight = 58
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - 5)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + 10
  const lastVisible = Math.min(results.length, firstVisible + visibleCount)
  const visibleResults = results.slice(firstVisible, lastVisible)

  return (
    <div
      ref={viewportRef}
      className="search-results-list name-search-results-list"
      aria-live="off"
      onScroll={(event) => {
        setScrollTop(event.currentTarget.scrollTop)
        onScroll()
      }}
    >
      {results.length ? (
        <div className="name-search-virtual-space" style={{ height: results.length * rowHeight }} role="list">
          {visibleResults.map((result, offset) => {
            const index = firstVisible + offset
            return (
              <button
                className="search-result name-search-result"
                key={result.path}
                type="button"
                role="listitem"
                aria-haspopup="menu"
                aria-expanded={menu?.result.path === result.path}
                onClick={(event) => onOpenMenu(event, result)}
                title={'操作 ' + result.path}
                style={{ top: index * rowHeight, height: rowHeight - 5 }}
              >
                <span className="search-result-heading">
                  <span className="search-result-icon"><File size={15} /></span>
                  <span className="search-result-title">{result.name}</span>
                </span>
                <span className="search-result-path">{result.path}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="search-results-empty">
          {running ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
          <span>{running ? '正在查找文件' : status === 'completed' ? '没有找到匹配文件' : '提交搜索后显示结果'}</span>
        </div>
      )}
    </div>
  )
}

