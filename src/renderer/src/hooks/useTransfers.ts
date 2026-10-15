import { useEffect, useState } from 'react'
import type { DroppedUploadEntry, RemoteEntry, TransferProgress, TransferResult } from '@shared/types'
import type { TransferJob } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UseTransfersOptions {
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
}

export function useTransfers({
  sessionId,
  currentPath,
  profileName,
  loadDirectory,
  showToast,
}: UseTransfersOptions) {
  const [transfers, setTransfers] = useState<Record<string, TransferJob>>({})

  useEffect(() => window.remoteFiles.onTransferProgress((progress: TransferProgress) => {
    setTransfers((current) => ({
      ...current,
      [progress.requestId]: {
        sessionId: progress.sessionId,
        profileName: current[progress.requestId]?.profileName ?? '',
        name: current[progress.requestId]?.name ?? progress.remotePath.split('/').pop() ?? '文件',
        direction: progress.direction,
        transferred: progress.transferred,
        total: progress.total,
        state: current[progress.requestId]?.state === 'starting'
          ? 'running'
          : current[progress.requestId]?.state ?? 'running',
      },
    }))
  }), [])

  const runTransfer = async (
    name: string,
    direction: TransferJob['direction'],
    operation: (requestId: string) => Promise<TransferResult>,
    { refreshPath, initialTotal = 0, deferTrayUntilProgress = false }: RunTransferOptions = {},
  ) => {
    if (!sessionId) return
    const activeSessionId = sessionId
    const requestId = crypto.randomUUID()
    setTransfers((current) => ({
      ...current,
      [requestId]: {
        sessionId: activeSessionId,
        profileName,
        name,
        direction,
        transferred: 0,
        total: initialTotal,
        state: deferTrayUntilProgress ? 'starting' : 'running',
      },
    }))
    try {
      const result = await operation(requestId)
      if (result === 'not-started') {
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
        return
      }
      setTransfers((current) => ({
        ...current,
        [requestId]: {
          ...current[requestId],
          sessionId: activeSessionId,
          profileName,
          transferred: result === 'completed'
            ? current[requestId]?.total ?? initialTotal
            : current[requestId]?.transferred ?? 0,
          state: result === 'completed' ? 'complete' : 'cancelled',
        },
      }))
      window.setTimeout(() => {
        setTransfers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      }, 2800)
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(activeSessionId, refreshPath)
    } catch (error) {
      setTransfers((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(activeSessionId, refreshPath)
      showToast('error', (direction === 'upload' ? '上传' : '下载') + '失败：' + errorMessage(error))
    }
  }

  const cancelTransfer = (requestId: string) => {
    const job = transfers[requestId]
    if (!job || job.state !== 'running') return
    setTransfers((current) => ({
      ...current,
      [requestId]: { ...current[requestId], state: 'cancelling' },
    }))
    void window.remoteFiles.cancelTransfer(requestId).catch((error) => {
      setTransfers((current) => {
        const active = current[requestId]
        return active?.state === 'cancelling'
          ? { ...current, [requestId]: { ...active, state: 'running' } }
          : current
      })
      showToast('error', '取消传输失败：' + errorMessage(error))
    })
  }

  const uploadFiles = () => {
    if (!sessionId) return
    const activeSessionId = sessionId
    const remoteDirectory = currentPath
    void runTransfer('上传文件', 'upload', (requestId) =>
      window.remoteFiles.uploadFiles(requestId, activeSessionId, remoteDirectory),
    { refreshPath: remoteDirectory, deferTrayUntilProgress: true })
  }

  const uploadFolder = () => {
    if (!sessionId) return
    const activeSessionId = sessionId
    const remoteDirectory = currentPath
    void runTransfer('上传文件夹', 'upload', (requestId) =>
      window.remoteFiles.uploadFolder(requestId, activeSessionId, remoteDirectory),
    { refreshPath: remoteDirectory, deferTrayUntilProgress: true })
  }

  const uploadDroppedEntries = (entries: DroppedUploadEntry[]) => {
    if (!sessionId) return
    if (entries.length === 0) {
      showToast('info', '拖入内容中没有可上传的文件或文件夹')
      return
    }
    const activeSessionId = sessionId
    const remoteDirectory = currentPath
    void runTransfer('拖放上传', 'upload', (requestId) =>
      window.remoteFiles.uploadDroppedEntries(requestId, activeSessionId, remoteDirectory, entries),
    { refreshPath: remoteDirectory, deferTrayUntilProgress: true })
  }

  const download = (entry: RemoteEntry) => {
    if (!sessionId) return
    const activeSessionId = sessionId
    void runTransfer(entry.name, 'download', (requestId) =>
      window.remoteFiles.downloadEntry(requestId, activeSessionId, entry.path),
    { initialTotal: entry.type === 'file' ? entry.size : 0 })
  }

  const dismissTransfer = (requestId: string) => {
    setTransfers((current) => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }

  return { transfers, cancelTransfer, uploadFiles, uploadFolder, uploadDroppedEntries, download, dismissTransfer }
}
