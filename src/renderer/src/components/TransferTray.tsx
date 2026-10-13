import { ArrowDownToLine, Check, Upload, X } from 'lucide-react'
import type { TransferJob } from '../app-types'

interface TransferTrayProps {
  transfers: Record<string, TransferJob>
  onCancel: (requestId: string) => void
  onDismiss: (requestId: string) => void
}

export default function TransferTray({ transfers, onCancel, onDismiss }: TransferTrayProps) {
  const jobs = Object.entries(transfers)
  if (jobs.length === 0) return null

  return (
    <div className="transfer-tray">
      {jobs.map(([id, job]) => {
        const complete = job.state === 'complete'
        const active = job.state === 'running' || job.state === 'cancelling'
        const percent = complete ? 100 : job.total > 0 ? Math.min(100, Math.round(job.transferred * 100 / job.total)) : 0
        const status = job.state === 'complete'
          ? '已完成'
          : job.state === 'cancelled'
            ? '已取消'
            : job.state === 'cancelling'
              ? '正在取消'
              : percent + '%'
        return (
          <div className="transfer-item" key={id}>
            <div className={'transfer-state-icon ' + (complete ? 'complete' : '') + ' ' + (job.state === 'cancelled' ? 'cancelled' : '')}>
              {complete ? <Check size={15} /> : job.state === 'cancelled' ? <X size={15} /> : job.direction === 'upload' ? <Upload size={15} /> : <ArrowDownToLine size={15} />}
            </div>
            <div className="transfer-copy">
              <div className="transfer-line"><span>{job.name}</span><span>{status}</span></div>
              <div className="progress-track">
                <div className={'progress-fill ' + (complete ? 'complete' : '') + ' ' + (job.state === 'cancelled' ? 'cancelled' : '')} style={{ width: percent + '%' }} />
              </div>
            </div>
            {active ? (
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
