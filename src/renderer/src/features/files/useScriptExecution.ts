import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import type { RemoteEntry, ScriptExecutionEvent, ScriptExecutionRequest } from '@shared/types'
import type { BrowserContextMenu, ScriptExecutionDialogState, SessionTab } from '../../app-types'
import type { ToastNotice } from '../../GlobalToast'
import { scriptExecutionCommand } from '@shared/shell'
import { errorMessage } from '../../app-utils'

export interface ScriptCommandDialog {
  entry: Pick<RemoteEntry, 'name' | 'path'>
  command: string
}

function updateExecutionByRequest(
  setExecutions: Dispatch<SetStateAction<Map<string, ScriptExecutionDialogState>>>,
  requestId: string,
  update: (execution: ScriptExecutionDialogState) => ScriptExecutionDialogState,
) {
  setExecutions((current) => {
    for (const [sessionId, execution] of current) {
      if (execution.request.requestId !== requestId) continue
      const next = new Map(current)
      next.set(sessionId, update(execution))
      return next
    }
    return current
  })
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
  const [scriptCommandDialogs, setScriptCommandDialogs] = useState<Map<string, ScriptCommandDialog>>(() => new Map())
  const [scriptExecutionDialogs, setScriptExecutionDialogs] = useState<Map<string, ScriptExecutionDialogState>>(() => new Map())

  useEffect(() => window.remoteFiles.onScriptExecutionEvent((event: ScriptExecutionEvent) => {
    updateExecutionByRequest(setScriptExecutionDialogs, event.requestId, (current) => {
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
    setScriptCommandDialogs((current) => new Map(current).set(session.id, {
      entry,
      command: scriptExecutionCommand(entry.name),
    }))
  }

  const startScriptExecution = (entry: Pick<RemoteEntry, 'name' | 'path'>, command: string, sessionId = activeSessionId) => {
    setBrowserContextMenu(null)
    if (sessionId) {
      setScriptCommandDialogs((current) => {
        if (!current.has(sessionId)) return current
        const next = new Map(current)
        next.delete(sessionId)
        return next
      })
    }
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
    setScriptExecutionDialogs((current) => new Map(current).set(session.id, {
      request,
      name: entry.name,
      status: 'starting',
      output: [],
      message: null,
    }))
    void window.remoteFiles.startScriptExecution(request).then(() => {
      updateExecutionByRequest(setScriptExecutionDialogs, request.requestId, (current) => current.status === 'starting'
        ? { ...current, status: 'running', message: null }
        : current)
    }).catch((error) => {
      updateExecutionByRequest(setScriptExecutionDialogs, request.requestId, (current) => ({
        ...current,
        status: 'failed',
        message: errorMessage(error),
      }))
    })
  }

  const runScript = (entry: Pick<RemoteEntry, 'name' | 'path'>, sessionId = activeSessionId) => {
    startScriptExecution(entry, scriptExecutionCommand(entry.name), sessionId)
  }

  const updateScriptCommand = (sessionId: string, command: string) => {
    setScriptCommandDialogs((current) => {
      const dialog = current.get(sessionId)
      if (!dialog) return current
      return new Map(current).set(sessionId, { ...dialog, command })
    })
  }

  const closeScriptCommandDialog = (sessionId: string) => {
    setScriptCommandDialogs((current) => {
      if (!current.has(sessionId)) return current
      const next = new Map(current)
      next.delete(sessionId)
      return next
    })
  }

  const submitScriptCommand = (sessionId: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const dialog = scriptCommandDialogs.get(sessionId)
    if (!dialog || !dialog.command.trim()) return
    if (dialog.command.length > 65535) {
      showToast('error', '命令长度不能超过 65535 个字符')
      return
    }
    startScriptExecution(dialog.entry, dialog.command, sessionId)
  }

  const closeScriptExecutionDialog = (sessionId: string) => {
    const execution = scriptExecutionDialogs.get(sessionId)
    if (execution && ['starting', 'running', 'cancelling'].includes(execution.status)) {
      void window.remoteFiles.cancelScriptExecution(execution.request.requestId)
    }
    setScriptExecutionDialogs((current) => {
      if (!current.has(sessionId)) return current
      const next = new Map(current)
      next.delete(sessionId)
      return next
    })
  }

  const stopScriptExecution = (sessionId: string) => {
    const execution = scriptExecutionDialogs.get(sessionId)
    if (!execution || !['starting', 'running'].includes(execution.status)) return
    const requestId = execution.request.requestId
    updateExecutionByRequest(setScriptExecutionDialogs, requestId, (current) => ({
      ...current,
      status: 'cancelling',
      message: null,
    }))
    void window.remoteFiles.cancelScriptExecution(requestId)
  }

  const removeSessionStates = (sessionIds: string[]) => {
    const removedIds = new Set(sessionIds)
    for (const sessionId of removedIds) {
      const execution = scriptExecutionDialogs.get(sessionId)
      if (execution && ['starting', 'running', 'cancelling'].includes(execution.status)) {
        void window.remoteFiles.cancelScriptExecution(execution.request.requestId)
      }
    }
    setScriptCommandDialogs((current) => {
      const next = new Map(current)
      for (const sessionId of removedIds) next.delete(sessionId)
      return next.size === current.size ? current : next
    })
    setScriptExecutionDialogs((current) => {
      const next = new Map(current)
      for (const sessionId of removedIds) next.delete(sessionId)
      return next.size === current.size ? current : next
    })
  }

  return {
    scriptCommandDialogs,
    scriptExecutionDialogs,
    requestScriptCommandEdit,
    startScriptExecution,
    runScript,
    updateScriptCommand,
    closeScriptCommandDialog,
    submitScriptCommand,
    closeScriptExecutionDialog,
    stopScriptExecution,
    removeSessionStates,
  }
}
