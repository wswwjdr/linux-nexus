export type TextLineEnding = '\n' | '\r\n' | '\r' | null

export type PreviewResult =
  | { type: 'text'; name: string; content: string; lineEnding: TextLineEnding }
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
