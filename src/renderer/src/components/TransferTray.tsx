import { AlertTriangle, ArrowDownToLine, Check, Upload, X } from 'lucide-react'
import type { TransferJob } from '@/app-types'

interface TransferTrayProps {
  sessionId: string | null
  transfers: Record<string, TransferJob>
  onCancel: (requestId: string) => void
  onDismiss: (requestId: string) => void
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function percentage(transferred: number, total: number): number {
  return total > 0 ? Math.min(100, Math.round(transferred * 100 / total)) : 0
}

export default function TransferTray({ sessionId, transfers, onCancel, onDismiss }: TransferTrayProps) {
  const jobs = Object.entries(transfers).filter(([, job]) => job.sessionId === sessionId && job.state !== 'starting')
  if (jobs.length === 0) return null

  return (
    <div className="transfer-tray">
      {jobs.map(([id, job]) => {
        const complete = job.state === 'complete'
        const hasErrors = job.state === 'completed-with-errors'
        const terminal = complete || hasErrors
        const percent = terminal ? 100 : percentage(job.transferred, job.total)
        const finishedFiles = job.completedFiles + job.failedFiles
        const status = complete
          ? `完成 · ${job.completedFiles} 个文件成功`
          : hasErrors
            ? `完成 · ${job.completedFiles} 个文件成功 · ${job.failures.length} 项失败`
            : job.state === 'cancelled'
              ? '已取消'
              : job.state === 'queued'
                ? '排队中'
                : job.state === 'cancelling'
                  ? '正在取消'
                  : `${finishedFiles}/${job.fileCount ?? 0} 个文件 · ${percent}%`
        const canCancel = job.state === 'running' || job.state === 'queued' || job.state === 'cancelling'
        return (
          <div className="transfer-item" key={id}>
            <div className={'transfer-state-icon ' + (complete ? 'complete' : '') + (hasErrors ? ' failed' : '') + (job.state === 'cancelled' ? ' cancelled' : '')}>
              {complete ? <Check size={15} /> : hasErrors ? <AlertTriangle size={15} /> : job.state === 'cancelled' ? <X size={15} /> : job.direction === 'upload' ? <Upload size={15} /> : <ArrowDownToLine size={15} />}
            </div>
            <div className="transfer-copy">
              <div className="transfer-line"><span>{job.name}</span><span>{status}</span></div>
              <div className={'progress-track' + (hasErrors ? ' failed' : '')}>
                <div className={'progress-fill ' + (complete ? 'complete' : '') + (hasErrors ? ' failed' : '') + (job.state === 'cancelled' ? ' cancelled' : '')} style={{ width: percent + '%' }} />
              </div>
              {job.activeFiles.length > 0 && (
                <div className="transfer-active-files">
                  {job.activeFiles.map((file) => {
                    const filePercent = percentage(file.transferred, file.total)
                    return (
                      <div className="transfer-active-file" key={file.remotePath}>
                        <div className="transfer-active-line">
                          <span title={file.remotePath}>{fileName(file.remotePath)}</span>
                          <span>{filePercent}%</span>
                        </div>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: filePercent + '%' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {hasErrors && (
                <details className="transfer-failures">
                  <summary>查看失败详情</summary>
                  <div className="transfer-failure-list">
                    {job.failures.map((failure, index) => (
                      <div className="transfer-failure" key={failure.path + index}>
                        <span title={failure.path}>{failure.path}</span>
                        <small>{failure.message}</small>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
            {canCancel ? (
              <button
                className="icon-button subtle"
                title={job.state === 'cancelling' ? '正在取消传输' : '取消传输'}
                aria-label={job.state === 'cancelling' ? '正在取消传输' : '取消传输'}
                disabled={job.state === 'cancelling'}
                onClick={() => onCancel(id)}
              ><X size={14} /></button>
            ) : (
              <button className="icon-button subtle" title="隐藏传输状态" aria-label="隐藏传输状态" onClick={() => onDismiss(id)}>
                <X size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
