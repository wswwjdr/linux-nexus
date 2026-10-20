import type { TransferFileProgress, TransferProgress } from '@shared/types'

interface TransferProgressContext {
  sender: Electron.WebContents
  requestId: string
  sessionId: string
  profileId: string
  remotePath: string
  direction: TransferProgress['direction']
  total: number
  fileCount: number
}

export interface TransferProgressReporter {
  fileStarted(remotePath: string, total: number): void
  fileAdvanced(remotePath: string, bytes: number): void
  fileFinished(remotePath: string, succeeded: boolean): void
  fileCancelled(remotePath: string): void
  flush(): void
}

export function createTransferProgressReporter(context: TransferProgressContext): TransferProgressReporter {
  const activeFiles = new Map<string, TransferFileProgress>()
  let settledBytes = 0
  let completedFiles = 0
  let failedFiles = 0
  let lastSentAt = 0
  let timer: NodeJS.Timeout | undefined

  const send = () => {
    timer = undefined
    lastSentAt = Date.now()
    if (context.sender.isDestroyed()) return
    const files = [...activeFiles.values()]
    const transferred = settledBytes + files.reduce((sum, file) => sum + file.transferred, 0)
    context.sender.send('files:transfer-progress', {
      requestId: context.requestId,
      sessionId: context.sessionId,
      profileId: context.profileId,
      remotePath: context.remotePath,
      direction: context.direction,
      transferred,
      total: context.total,
      fileCount: context.fileCount,
      completedFiles,
      failedFiles,
      activeFiles: files,
    } satisfies TransferProgress)
  }

  const report = (immediate = false) => {
    const delay = 100 - (Date.now() - lastSentAt)
    if (immediate || delay <= 0) {
      if (timer) clearTimeout(timer)
      send()
    } else if (!timer) {
      timer = setTimeout(send, delay)
    }
  }

  return {
    fileStarted(remotePath, total) {
      activeFiles.set(remotePath, { remotePath, transferred: 0, total })
      report(true)
    },
    fileAdvanced(remotePath, bytes) {
      const file = activeFiles.get(remotePath)!
      file.transferred += bytes
      report()
    },
    fileFinished(remotePath, succeeded) {
      const file = activeFiles.get(remotePath)!
      activeFiles.delete(remotePath)
      settledBytes += file.transferred
      if (succeeded) completedFiles += 1
      else failedFiles += 1
      report(true)
    },
    fileCancelled(remotePath) {
      const file = activeFiles.get(remotePath)
      if (!file) return
      activeFiles.delete(remotePath)
      settledBytes += file.transferred
      report(true)
    },
    flush() {
      if (timer) clearTimeout(timer)
      send()
    },
  }
}
