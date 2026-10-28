export type TextLineEnding = '\n' | '\r\n' | '\r' | null

export interface TextFileRevision {
  contentHash: string
  lineEnding: TextLineEnding
}

export interface TextFileSaveResult {
  status: 'saved'
  revision: TextFileRevision
}

export interface TextFileSaveConflict {
  status: 'conflict'
  currentHash: string
}

export type PreviewResult =
  | { type: 'text'; name: string; content: string; revision: TextFileRevision }
  | { type: 'markdown'; name: string; content: string }
  | { type: 'pdf'; name: string; url: string; token: string }
  | { type: 'image'; name: string; url: string; token: string }
  | { type: 'audio'; name: string; url: string; token: string }
  | { type: 'video'; name: string; url: string; token: string }

export interface LogPreviewPage {
  name: string
  content: string
  startOffset: number
  fileSize: number
  limitBytes: number
  hasEarlier: boolean
}
