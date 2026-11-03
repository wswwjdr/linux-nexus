import { Fragment, useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { File, LoaderCircle, Search } from 'lucide-react'
import type { ContentSearchResult } from '@shared/types'
import { formatSize } from '@/app-utils'
import { findTextMatches } from '@/text-search'
import type { ResultMenuState, SearchStatus } from './SearchPaneShared'

interface ContentSearchResultsProps {
  results: ContentSearchResult[]
  query: string
  ignoreCase: boolean
  running: boolean
  status: SearchStatus
  menu: ResultMenuState | null
  onOpenMenu: (event: MouseEvent<HTMLButtonElement>, result: ContentSearchResult) => void
  onScroll: () => void
}

export function ContentSearchResults(props: ContentSearchResultsProps) {
  if (props.results.length === 0) {
    return (
      <div className="search-results-list content-search-results-list" aria-live="off">
        <div className="search-results-empty">
          {props.running ? <LoaderCircle className="spin" size={20} /> : <Search size={20} />}
          <span>{props.running ? '等待匹配结果' : props.status === 'completed' ? '没有找到匹配内容' : '提交搜索后显示结果'}</span>
        </div>
      </div>
    )
  }
  return <MeasuredContentSearchResults {...props} />
}

function MeasuredContentSearchResults({ results, query, ignoreCase, menu, onOpenMenu, onScroll }: ContentSearchResultsProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const getItemKey = useCallback((index: number) => results[index].path, [results])
  const virtual = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: results.length,
    getScrollElement: () => viewportRef.current,
    getItemKey,
    estimateSize: () => 140,
    measureElement: element => element.offsetHeight,
    overscan: 5,
  })

  useEffect(() => {
    const viewport = viewportRef.current!
    let width = viewport.clientWidth
    const observer = new ResizeObserver(() => {
      const nextWidth = viewport.clientWidth
      if (nextWidth === 0 || nextWidth === width) return
      width = nextWidth
      // Wrapped snippets change height when the panel width changes.
      virtual.measure()
      viewport.querySelectorAll<HTMLDivElement>('[data-index]').forEach(virtual.measureElement)
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [virtual])

  return (
    <div ref={viewportRef} className="search-results-list content-search-results-list" aria-live="off" onScroll={onScroll}>
      <div className="content-search-virtual-space" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((item) => {
          const result = results[item.index]
          return (
            <div className="content-search-virtual-row" key={item.key} data-index={item.index} ref={virtual.measureElement} style={{ transform: `translateY(${item.start}px)` }}>
              <button
                className="search-result content-search-result"
                type="button"
                aria-haspopup="menu"
                aria-expanded={menu?.result.path === result.path}
                onClick={(event) => onOpenMenu(event, result)}
                title={'操作 ' + result.path}
              >
                <span className="search-result-heading">
                  <span className="search-result-icon"><File size={15} /></span>
                  <span className="search-result-title">{result.name}</span>
                  <span className="search-result-size">{formatSize(result.size)}</span>
                </span>
                <span className="search-result-path">{result.path}</span>
                <span className="search-result-matches">
                  {result.matches.map((match) => (
                    <span className="search-match-block" key={match.lineNumber}>
                      {match.before && <span className="search-match-line context"><span>{match.before.lineNumber}</span><code>{match.before.text || ' '}</code></span>}
                      <span className="search-match-line hit"><span>{match.lineNumber}</span><code><HighlightedText text={match.text} query={query} ignoreCase={ignoreCase} /></code></span>
                      {match.after && <span className="search-match-line context"><span>{match.after.lineNumber}</span><code>{match.after.text || ' '}</code></span>}
                    </span>
                  ))}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HighlightedText({ text, query, ignoreCase }: { text: string; query: string; ignoreCase: boolean }) {
  const offsets = findTextMatches(text, query, !ignoreCase)
  let end = 0
  return <>{offsets.map((offset) => {
    const start = end
    end = offset + query.length
    return <Fragment key={offset}>{text.slice(start, offset)}<mark>{text.slice(offset, end)}</mark></Fragment>
  })}{text.slice(end) || (text.length === 0 ? ' ' : '')}</>
}
