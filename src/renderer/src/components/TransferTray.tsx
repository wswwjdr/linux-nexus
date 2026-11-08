import { renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
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
  useLanguage()
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
        const label = job.direction === 'upload' ? tr('transfers.upload') : tr('transfers.download')
        const status = complete
          ? tr('transfers.completedFiles', { label, count: job.completedFiles })
          : hasErrors
            ? tr('transfers.finishedFilesSucceededFailures', { "label": label, "completedFiles": job.completedFiles, "length": job.failures.length })
            : job.state === 'cancelled'
              ? tr('transfers.cancelledRemoteStateUnconfirmed')
              : job.state === 'queued'
                ? tr('transfers.queued')
                : job.state === 'cancelling'
                  ? tr('transfers.cancelling')
                  : tr('transfers.files', { "finishedFiles": finishedFiles, "value2": job.fileCount ?? 0, "percent": percent })
        const canCancel = job.state === 'running' || job.state === 'queued' || job.state === 'cancelling'
        return (
          <div className="transfer-item" key={id}>
            <div className={'transfer-state-icon ' + (complete ? 'complete' : '') + (hasErrors ? ' failed' : '') + (job.state === 'cancelled' ? ' cancelled' : '')}>
              {complete ? <Check size={15} /> : hasErrors ? <AlertTriangle size={15} /> : job.state === 'cancelled' ? <X size={15} /> : job.direction === 'upload' ? <Upload size={15} /> : <ArrowDownToLine size={15} />}
            </div>
            <div className="transfer-copy">
              <div className="transfer-line"><span>{renderMessage(job.name)}</span><span>{status}</span></div>
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
                  <summary>{tr('transfers.viewFailureDetails')}</summary>
                  <div className="transfer-failure-list">
                    {job.failures.map((failure, index) => (
                      <div className="transfer-failure" key={failure.path + index}>
                        <span title={failure.path}>{failure.path}</span>
                        <small>{renderMessage(failure.message)}</small>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
            {canCancel ? (
              <button
                className="icon-button subtle"
                title={job.state === 'cancelling' ? tr('transfers.cancellingTransfer') : tr('transfers.cancelTransfer')}
                aria-label={job.state === 'cancelling' ? tr('transfers.cancellingTransfer') : tr('transfers.cancelTransfer')}
                disabled={job.state === 'cancelling'}
                onClick={() => onCancel(id)}
              ><X size={14} /></button>
            ) : (
              <button className="icon-button subtle" title={tr('transfers.hideTransferStatus')} aria-label={tr('transfers.hideTransferStatus')} onClick={() => onDismiss(id)}>
                <X size={14} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
