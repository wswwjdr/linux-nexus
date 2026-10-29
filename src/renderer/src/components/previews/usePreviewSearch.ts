import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { findTextMatches } from './text-search'

export interface PreviewSearchHandle {
  openSearch: () => void
  closeSearch: () => boolean
}

export function usePreviewSearch(content: string, fromEnd = false) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  // End-relative anchors keep the current log match stable when earlier pages are prepended.
  const [anchor, setAnchor] = useState(0)
  const [revealRequest, setRevealRequest] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const matches = useMemo(() => searchOpen ? findTextMatches(content, query, caseSensitive) : [], [content, query, caseSensitive, searchOpen])
  const offset = fromEnd ? content.length - anchor : anchor
  const foundIndex = matches.findIndex((start) => start >= offset)
  const matchIndex = matches.length ? foundIndex === -1 ? matches.length - 1 : foundIndex : -1
  const matchStart = matches[matchIndex]
  const matchEnd = matchStart === undefined ? undefined : matchStart + query.length
  const reveal = () => setRevealRequest((value) => value + 1)

  const openSearch = (selected = '', start = fromEnd ? content.length : 0) => {
    if (selected && !/[\r\n]/.test(selected)) setQuery(selected)
    setAnchor(fromEnd ? content.length - start : start)
    setSearchOpen(true)
    reveal()
    searchRef.current?.focus()
    searchRef.current?.select()
  }
  useLayoutEffect(() => {
    if (searchOpen) {
      searchRef.current!.focus()
      searchRef.current!.select()
    }
  }, [searchOpen])

  const closeSearch = () => {
    if (!searchOpen) return false
    setSearchOpen(false)
    return true
  }
  const navigate = (direction: number) => {
    if (!matches.length) return
    const start = matches[(matchIndex + direction + matches.length) % matches.length]
    setAnchor(fromEnd ? content.length - start : start)
    reveal()
  }
  return {
    searchOpen, query, caseSensitive, searchRef, matches, matchIndex, matchStart, matchEnd, revealRequest,
    openSearch, closeSearch, navigate,
    updateQuery(value: string) { setQuery(value); setAnchor(0); reveal() },
    toggleCase() { setCaseSensitive(!caseSensitive); setAnchor(0); reveal() },
  }
}

export type PreviewSearch = ReturnType<typeof usePreviewSearch>
