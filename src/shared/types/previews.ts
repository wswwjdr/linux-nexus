export type TextLineEnding = '\n' | '\r\n' | '\r' | null
export type TextEncoding = 'utf8' | 'gbk'
export interface TextFileVersion { hash: string; identity: string }
export interface TextSaveOptions { version: TextFileVersion; encoding: TextEncoding; bom: boolean; force: boolean }
export type TextSaveResult = { status: 'saved'; version: TextFileVersion } | { status: 'conflict' }

export type PreviewResult =
  | { type: 'text'; name: string; content: string; lineEnding: TextLineEnding; encoding: TextEncoding; bom: boolean; version: TextFileVersion }
  | { type: 'markdown'; name: string; content: string; token: string; resourceBaseUrl: string }
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
