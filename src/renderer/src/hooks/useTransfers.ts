import { useEffect, useRef, useState } from 'react'
import type { DroppedUploadEntry, OperationExecutionStrategy, OperationStrategy, RemoteEntry, TransferProgress, TransferResult, UploadPreflight } from '@shared/types'
import type { TransferJob } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UseTransfersOptions {
  activeSessionId: string | null
  sessionIds: ReadonlySet<string>
  sessionId: string | null
  currentPath: string
  profileName: string
  loadDirectory: (sessionId: string, remotePath: string) => Promise<boolean>
  showToast: (kind: ToastNotice['kind'], message: string) => void
}

interface RunTransferOptions {
  refreshPath?: string
  initialTotal?: number
  deferTrayUntilProgress?: boolean
  requestId?: string
  sessionId?: string
}

export function useTransfers({
  activeSessionId,
  sessionIds,
  sessionId,
  currentPath,
  profileName,
  loadDirectory,
  showToast,
}: UseTransfersOptions) {
  const [transfers, setTransfers] = useState<Record<string, TransferJob>>({})
  const [uploadPreflight, setUploadPreflight] = useState<UploadPreflight | null>(null)
  const [uploadPreflightBusy, setUploadPreflightBusy] = useState(false)
  const completionTimers = useRef(new Map<string, number>())
  const sessionIdsRef = useRef(sessionIds)
  sessionIdsRef.current = sessionIds

  useEffect(() => {
    setTransfers((current) => {
      const next = { ...current }
      let changed = false
      for (const [requestId, job] of Object.entries(current)) {
        if (sessionIds.has(job.sessionId)) continue
        delete next[requestId]
        changed = true
      }
      return changed ? next : current
    })
  }, [sessionIds])

  useEffect(() => {
    for (const [requestId, timer] of completionTimers.current) {
      const job = transfers[requestId]
      if (job?.sessionId === activeSessionId && (job.state === 'complete' || job.state === 'cancelled')) continue
      window.clearTimeout(timer)
      completionTimers.current.delete(requestId)
    }

    if (!activeSessionId) return
    for (const [requestId, job] of Object.entries(transfers)) {
      if (job.sessionId !== activeSessionId
        || (job.state !== 'complete' && job.state !== 'cancelled')
        || completionTimers.current.has(requestId)) continue
      const timer = window.setTimeout(() => {
        completionTimers.current.delete(requestId)
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      }, 2800)
      completionTimers.current.set(requestId, timer)
    }
  }, [activeSessionId, transfers])

  useEffect(() => () => {
    for (const timer of completionTimers.current.values()) window.clearTimeout(timer)
    completionTimers.current.clear()
  }, [])

  useEffect(() => {
    const unlistenQueued = window.remoteFiles.onTransferQueued(({ requestId }) => {
      setTransfers((current) => current[requestId]
        ? { ...current, [requestId]: { ...current[requestId], state: 'queued' } }
        : current)
    })
    const unlistenProgress = window.remoteFiles.onTransferProgress((progress: TransferProgress) => {
      if (!sessionIdsRef.current.has(progress.sessionId)) return
      setTransfers((current) => ({
        ...current,
        [progress.requestId]: {
          sessionId: progress.sessionId,
          profileName: current[progress.requestId]?.profileName ?? '',
          name: current[progress.requestId]?.name ?? progress.remotePath.split('/').pop() ?? '文件',
          direction: progress.direction,
          transferred: progress.transferred,
          total: progress.total,
          fileCount: progress.fileCount,
          completedFiles: progress.completedFiles,
          failedFiles: progress.failedFiles,
          activeFiles: progress.activeFiles,
          failures: current[progress.requestId]?.failures ?? [],
          state: current[progress.requestId]?.state === 'starting' || current[progress.requestId]?.state === 'queued'
            ? 'running'
            : current[progress.requestId]?.state ?? 'running',
        },
      }))
    })
    return () => {
      unlistenQueued()
      unlistenProgress()
    }
  }, [])

  const runTransfer = async (
    name: string,
    direction: TransferJob['direction'],
    operation: (requestId: string) => Promise<TransferResult>,
    { refreshPath, initialTotal = 0, deferTrayUntilProgress = false, requestId: requestedId, sessionId: requestedSessionId }: RunTransferOptions = {},
  ) => {
    const activeSessionId = requestedSessionId ?? sessionId
    if (!activeSessionId) return
    const requestId = requestedId ?? crypto.randomUUID()
    setTransfers((current) => ({
      ...current,
      [requestId]: {
        sessionId: activeSessionId,
        profileName,
        name,
        direction,
        transferred: 0,
        total: initialTotal,
        completedFiles: 0,
        failedFiles: 0,
        activeFiles: [],
        failures: [],
        state: deferTrayUntilProgress ? 'starting' : 'running',
      },
    }))
    try {
      const result = await operation(requestId)
      if (result.status === 'not-started') {
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
        return
      }
      setTransfers((current) => {
        if (!sessionIdsRef.current.has(activeSessionId)) {
          const next = { ...current }
          delete next[requestId]
          return next
        }
        return {
          ...current,
          [requestId]: {
            ...current[requestId],
            sessionId: activeSessionId,
            profileName,
            transferred: result.status === 'completed'
              ? current[requestId]?.total ?? initialTotal
              : current[requestId]?.transferred ?? 0,
            completedFiles: result.status === 'completed'
              ? current[requestId]?.fileCount ?? current[requestId]?.completedFiles ?? 0
              : current[requestId]?.completedFiles ?? 0,
            activeFiles: [],
            failures: result.status === 'completed-with-errors' ? result.failures : [],
            failedFiles: result.status === 'completed-with-errors'
              ? result.failures.length
              : current[requestId]?.failedFiles ?? 0,
            state: result.status === 'completed'
              ? 'complete'
              : result.status === 'completed-with-errors'
                ? 'completed-with-errors'
                : 'cancelled',
          },
        }
      })
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(activeSessionId, refreshPath)
    } catch (error) {
      setTransfers((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      if (!sessionIdsRef.current.has(activeSessionId)) return
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(activeSessionId, refreshPath)
      showToast('error', (direction === 'upload' ? '上传' : '下载') + '失败：' + errorMessage(error))
    }
  }

  const cancelTransfer = (requestId: string) => {
    const job = transfers[requestId]
    if (!job || (job.state !== 'running' && job.state !== 'queued')) return
    const previousState = job.state
    setTransfers((current) => ({
      ...current,
      [requestId]: { ...current[requestId], state: 'cancelling' },
    }))
    void window.remoteFiles.cancelTransfer(requestId).catch((error) => {
      setTransfers((current) => {
        const active = current[requestId]
        return active?.state === 'cancelling'
          ? { ...current, [requestId]: { ...active, state: previousState } }
          : current
      })
      showToast('error', '取消传输失败：' + errorMessage(error))
    })
  }

  const prepareUpload = async (mode: 'files' | 'folder' | 'drop', strategy: OperationStrategy, entries?: DroppedUploadEntry[]) => {
    if (!sessionId) return
    const activeSessionId = sessionId
    const remoteDirectory = currentPath
    try {
      const preflight = await window.remoteFiles.preflightUpload({
        requestId: crypto.randomUUID(),
        sessionId: activeSessionId,
        remoteDirectory,
        mode,
        strategy,
        ...(entries ? { entries } : {}),
      })
      if (preflight) setUploadPreflight(preflight)
    } catch (error) {
      showToast('error', '上传预检失败：' + errorMessage(error))
    }
  }

  const uploadFiles = (strategy: OperationStrategy = 'confirm') => void prepareUpload('files', strategy)
  const uploadFolder = (strategy: OperationStrategy = 'confirm') => void prepareUpload('folder', strategy)

  const uploadDroppedEntries = (entries: DroppedUploadEntry[], strategy: OperationStrategy = 'confirm') => {
    if (!sessionId) return
    if (entries.length === 0) {
      showToast('info', '拖入内容中没有可上传的文件或文件夹')
      return
    }
    void prepareUpload('drop', strategy, entries)
  }

  const confirmUploadPreflight = async (strategy: OperationExecutionStrategy) => {
    const preflight = uploadPreflight
    if (!preflight || uploadPreflightBusy) return
    setUploadPreflightBusy(true)
    setUploadPreflight(null)
    await runTransfer(preflight.name, 'upload', () => window.remoteFiles.executeUpload({ preflightId: preflight.preflightId, strategy }), {
      refreshPath: preflight.remoteDirectory,
      initialTotal: preflight.items.reduce((sum, item) => sum + (item.type === 'file' ? item.size : 0), 0),
      deferTrayUntilProgress: true,
      requestId: preflight.requestId,
      sessionId: preflight.sessionId,
    })
    setUploadPreflightBusy(false)
  }

  const cancelUploadPreflight = () => {
    if (!uploadPreflight || uploadPreflightBusy) return
    void window.remoteFiles.cancelUploadPreflight(uploadPreflight.preflightId)
      .catch((error) => showToast('error', '取消上传预检失败：' + errorMessage(error)))
    setUploadPreflight(null)
  }

  const download = (entries: RemoteEntry[]) => {
    if (!sessionId) return
    if (entries.length === 0) return
    const activeSessionId = sessionId
    const name = entries.length === 1 ? entries[0].name : `下载 ${entries.length} 项`
    void runTransfer(name, 'download', (requestId) =>
      window.remoteFiles.downloadEntries(requestId, activeSessionId, entries.map((entry) => entry.path)),
    { initialTotal: entries.reduce((total, entry) => total + (entry.type === 'file' ? entry.size : 0), 0) })
  }

  const dismissTransfer = (requestId: string) => {
    setTransfers((current) => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }

  return {
    transfers,
    uploadPreflight,
    uploadPreflightBusy,
    cancelUploadPreflight,
    confirmUploadPreflight,
    cancelTransfer,
    uploadFiles,
    uploadFolder,
    uploadDroppedEntries,
    download,
    dismissTransfer,
  }
}
