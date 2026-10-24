export interface ScriptExecutionRequest {
  requestId: string
  sessionId: string
  scriptPath: string
  command: string
}

export type ScriptExecutionEvent =
  | { type: 'output'; requestId: string; sessionId: string; stream: 'stdout' | 'stderr'; data: string }
  | { type: 'completed'; requestId: string; sessionId: string; exitCode: 0 }
  | { type: 'cancelled'; requestId: string; sessionId: string }
  | { type: 'failed'; requestId: string; sessionId: string; exitCode?: number | null; message: string }
