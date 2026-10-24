import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { RemoteEntry, ScriptExecutionEvent, ScriptExecutionRequest } from '@shared/types'
import type { BrowserContextMenu, ScriptExecutionDialogState, SessionTab } from '../../app-types'
import type { ToastNotice } from '../../GlobalToast'
import { scriptExecutionCommand } from '@shared/shell'
import { errorMessage } from '../../app-utils'

interface ScriptCommandDialog {
  entry: Pick<RemoteEntry, 'name' | 'path'>
  sessionId: string
  command: string
}

interface UseScriptExecutionOptions {
  activeSessionId?: string
  sessionsRef: { current: SessionTab[] }
  setBrowserContextMenu: Dispatch<SetStateAction<BrowserContextMenu | null>>
  showToast: (kind: ToastNotice['kind'], message: string, action?: ToastNotice['action']) => void
}

export function useScriptExecution({
  activeSessionId,
  sessionsRef,
  setBrowserContextMenu,
  showToast,
}: UseScriptExecutionOptions) {
  const [scriptCommandDialog, setScriptCommandDialog] = useState<ScriptCommandDialog | null>(null)
  const [scriptExecutionDialog, setScriptExecutionDialog] = useState<ScriptExecutionDialogState | null>(null)

  useEffect(() => window.remoteFiles.onScriptExecutionEvent((event: ScriptExecutionEvent) => {
    setScriptExecutionDialog((current) => {
      if (!current || current.request.requestId !== event.requestId) return current
      if (event.type === 'output') {
        return { ...current, output: [...current.output, { stream: event.stream, data: event.data }] }
      }
      if (event.type === 'completed') return { ...current, status: 'completed', message: '退出码 0' }
      if (event.type === 'cancelled') return { ...current, status: 'cancelled', message: null }
      return { ...current, status: 'failed', message: event.message }
    })
  }), [])

  const requestScriptCommandEdit = (entry: Pick<RemoteEntry, 'name' | 'path'>, sessionId = activeSessionId) => {
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || session.kind !== 'sftp' || session.status !== 'connected') return
    setBrowserContextMenu(null)
    setScriptCommandDialog({
      entry,
      sessionId: session.id,
      command: scriptExecutionCommand(entry.name),
    })
  }

  const startScriptExecution = (entry: Pick<RemoteEntry, 'name' | 'path'>, command: string, sessionId = activeSessionId) => {
    setBrowserContextMenu(null)
    setScriptCommandDialog(null)
    const session = sessionsRef.current.find((candidate) => candidate.id === sessionId)
    if (!session || session.kind !== 'sftp' || session.status !== 'connected') {
      showToast('error', 'SFTP 会话已断开，无法执行脚本')
      return
    }
    const request: ScriptExecutionRequest = {
      requestId: crypto.randomUUID(),
      sessionId: session.id,
      scriptPath: entry.path,
      command,
    }
    setScriptExecutionDialog({ request, name: entry.name, status: 'starting', output: [], message: null })
    void window.remoteFiles.startScriptExecution(request).then(() => {
      setScriptExecutionDialog((current) => current?.request.requestId === request.requestId && current.status === 'starting'
        ? { ...current, status: 'running', message: null }
        : current)
    }).catch((error) => {
      setScriptExecutionDialog((current) => current?.request.requestId === request.requestId
        ? { ...current, status: 'failed', message: errorMessage(error) }
        : current)
    })
  }

  const runScript = (entry: Pick<RemoteEntry, 'name' | 'path'>, sessionId = activeSessionId) => {
    startScriptExecution(entry, scriptExecutionCommand(entry.name), sessionId)
  }

  const submitScriptCommand = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!scriptCommandDialog || !scriptCommandDialog.command.trim()) return
    if (scriptCommandDialog.command.length > 65535) {
      showToast('error', '命令长度不能超过 65535 个字符')
      return
    }
    startScriptExecution(scriptCommandDialog.entry, scriptCommandDialog.command, scriptCommandDialog.sessionId)
  }

  const closeScriptExecutionDialog = () => {
    if (scriptExecutionDialog && ['starting', 'running', 'cancelling'].includes(scriptExecutionDialog.status)) {
      void window.remoteFiles.cancelScriptExecution(scriptExecutionDialog.request.requestId)
    }
    setScriptExecutionDialog(null)
  }

  const stopScriptExecution = () => {
    if (!scriptExecutionDialog || !['starting', 'running'].includes(scriptExecutionDialog.status)) return
    const requestId = scriptExecutionDialog.request.requestId
    setScriptExecutionDialog((current) => current?.request.requestId === requestId
      ? { ...current, status: 'cancelling', message: null }
      : current)
    void window.remoteFiles.cancelScriptExecution(requestId)
  }

  return {
    scriptCommandDialog,
    scriptExecutionDialog,
    setScriptCommandDialog,
    requestScriptCommandEdit,
    startScriptExecution,
    runScript,
    submitScriptCommand,
    closeScriptExecutionDialog,
    stopScriptExecution,
  }
}
