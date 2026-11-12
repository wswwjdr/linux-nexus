import { useEffect, useRef, useState } from 'react'
import type { RemoteEntry } from '@shared/types'
import { type MessageValue, messageFromUnknown } from '@shared/i18n/messages'
import { entryNameCollator } from '@/app-utils'

type DirectoryQuery = {
  directory: string
  entries: RemoteEntry[]
} & ({ status: 'loading' | 'ready' } | { status: 'error'; error: MessageValue })

function completionContext(draft: string, caret: number) {
  const slash = caret === 0 ? -1 : draft.lastIndexOf('/', caret - 1)
  const nextSlash = draft.indexOf('/', caret)
  return {
    directory: slash < 0 ? '' : draft.slice(0, slash + 1),
    prefix: draft.slice(slash + 1, caret),
    segmentEnd: nextSlash < 0 ? draft.length : nextSlash,
  }
}

export function usePathCompletion(sessionId: string, initialPath: string) {
  const [draft, setDraft] = useState(initialPath)
  const [caret, setCaret] = useState(initialPath.length)
  const [query, setQuery] = useState<DirectoryQuery | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [completionCaret, setCompletionCaret] = useState<{ position: number } | null>(null)
  const requestId = useRef(0)

  useEffect(() => () => { requestId.current++ }, [])

  const dismiss = () => {
    requestId.current++
    setQuery(null)
    setActiveIndex(-1)
  }

  const load = async (directory: string) => {
    const id = ++requestId.current
    setActiveIndex(-1)
    setQuery({ directory, status: 'loading', entries: [] })
    try {
      const entries = await window.remoteFiles.listDirectory(sessionId, directory)
      if (requestId.current !== id) return
      setQuery({
        directory, status: 'ready',
        entries: entries.filter(entry => entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory'))
          .sort((left, right) => entryNameCollator.compare(left.name, right.name)),
      })
    } catch (error) {
      if (requestId.current === id) setQuery({ directory, status: 'error', entries: [], error: messageFromUnknown(error) })
    }
  }

  const changeDraft = (value: string, position: number) => {
    setDraft(value)
    setCaret(position)
    setCompletionCaret(null)
    setActiveIndex(-1)
    const context = completionContext(value, position)
    if (value !== draft && position > 0 && value[position - 1] === '/') {
      void load(context.directory)
    } else if (context.directory !== query?.directory) {
      dismiss()
    }
  }

  const moveCaret = (position: number) => {
    if (position === caret) return
    setCaret(position)
    setActiveIndex(-1)
    if (completionContext(draft, position).directory !== query?.directory) dismiss()
  }

  const context = completionContext(draft, caret)
  const suggestions = query?.directory === context.directory
    ? query.entries.filter(entry => entry.name.startsWith(context.prefix)) : []

  const accept = (entry: RemoteEntry) => {
    const directory = `${context.directory}${entry.name}/`
    const suffix = draft.slice(context.segmentEnd).replace(/^\//, '')
    setDraft(directory + suffix)
    setCaret(directory.length)
    setCompletionCaret({ position: directory.length })
    void load(directory)
  }

  const moveSelection = (direction: 1 | -1) => {
    if (suggestions.length === 0) return
    setActiveIndex(index => index < 0
      ? direction === 1 ? 0 : suggestions.length - 1
      : (index + direction + suggestions.length) % suggestions.length)
  }

  return { draft, query, suggestions, activeIndex, completionCaret, changeDraft, moveCaret, moveSelection, accept, dismiss }
}
