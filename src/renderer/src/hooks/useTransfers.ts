import { useEffect, useState } from 'react'
import type { RemoteEntry, TransferProgress, TransferResult } from '@shared/types'
import type { TransferJob } from '../app-types'
import type { ToastNotice } from '../GlobalToast'
import { errorMessage } from '../app-utils'

interface UseTransfersOptions {
  connectedProfileId: string | null
  currentPath: string
  loadDirectory: (profileId: string, remotePath: string) => Promise<boolean>
  showToast: (kind: ToastNotice['kind'], message: string) => void
}

interface RunTransferOptions {
  refreshPath?: string
  initialTotal?: number
  deferTrayUntilProgress?: boolean
}

export function useTransfers({
  connectedProfileId,
  currentPath,
  loadDirectory,
  showToast,
}: UseTransfersOptions) {
  const [transfers, setTransfers] = useState<Record<string, TransferJob>>({})

  useEffect(() => window.remoteFiles.onTransferProgress((progress: TransferProgress) => {
    setTransfers((current) => ({
      ...current,
      [progress.requestId]: {
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
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const requestId = crypto.randomUUID()
    setTransfers((current) => ({
      ...current,
      [requestId]: {
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
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(profileId, refreshPath)
    } catch (error) {
      setTransfers((current) => {
        const next = { ...current }
        delete next[requestId]
        return next
      })
      if (refreshPath !== undefined && direction === 'upload') await loadDirectory(profileId, refreshPath)
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
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const remoteDirectory = currentPath
    void runTransfer('上传文件', 'upload', (requestId) =>
      window.remoteFiles.uploadFiles(requestId, profileId, remoteDirectory),
    { refreshPath: remoteDirectory, deferTrayUntilProgress: true })
  }

  const uploadFolder = () => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    const remoteDirectory = currentPath
    void runTransfer('上传文件夹', 'upload', (requestId) =>
      window.remoteFiles.uploadFolder(requestId, profileId, remoteDirectory),
    { refreshPath: remoteDirectory, deferTrayUntilProgress: true })
  }

  const download = (entry: RemoteEntry) => {
    if (!connectedProfileId) return
    const profileId = connectedProfileId
    void runTransfer(entry.name, 'download', (requestId) =>
      window.remoteFiles.downloadEntry(requestId, profileId, entry.path),
    { initialTotal: entry.type === 'file' ? entry.size : 0 })
  }

  const dismissTransfer = (requestId: string) => {
    setTransfers((current) => {
      const next = { ...current }
      delete next[requestId]
      return next
    })
  }

  return { transfers, cancelTransfer, uploadFiles, uploadFolder, download, dismissTransfer }
}
