export type SearchScope = 'current' | 'root' | 'custom'
export type NameSearchMatchMode = 'exact' | 'contains'

export interface NameSearchRequest {
  requestId: string
  sessionId: string
  profileId: string
  rootPath: string
  query: string
  matchMode: NameSearchMatchMode
  ignoreCase: boolean
}

export interface ContentSearchRequest {
  requestId: string
  sessionId: string
  profileId: string
  rootPath: string
  query: string
  ignoreCase: boolean
  maxFileSizeMiB: number
}

export interface SearchResultTarget {
  name: string
  path: string
  type: 'file'
}

export interface NameSearchResult extends SearchResultTarget {}

export interface ContentSearchLineMatch {
  lineNumber: number
  before?: { lineNumber: number; text: string }
  text: string
  after?: { lineNumber: number; text: string }
}

export interface ContentSearchResult extends SearchResultTarget {
  size: number
  matches: ContentSearchLineMatch[]
}

export type SearchRunStatus = 'completed' | 'cancelled' | 'failed'

export interface NameSearchProgress {
  requestId: string
  sessionId: string
  profileId: string
  elapsedMs: number
  matchedFiles: number
  incomplete: boolean
  hasReadErrors: boolean
}

export type NameSearchEvent =
  | ({ type: 'progress' } & NameSearchProgress)
  | ({ type: 'results'; results: NameSearchResult[] } & NameSearchProgress)
  | ({ type: 'finished'; status: SearchRunStatus; message?: string } & NameSearchProgress)

export interface ContentSearchProgress {
  requestId: string
  sessionId: string
  profileId: string
  elapsedMs: number
  processedFiles: number
  processedBytes: number
  matchedFiles: number
  matchedLines: number
  skippedLargeFiles: number
  skippedBinaryFiles: number
  readErrors: number
  currentPath: string | null
  incomplete: boolean
}

export type ContentSearchEvent =
  | ({ type: 'progress' } & ContentSearchProgress)
  | ({ type: 'results'; results: ContentSearchResult[] } & ContentSearchProgress)
  | ({ type: 'finished'; status: SearchRunStatus; message?: string } & ContentSearchProgress)
