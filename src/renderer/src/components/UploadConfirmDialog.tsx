import { useId, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { OperationExecutionStrategy, UploadSelection } from '@shared/types'

const strategyLabels: Record<OperationExecutionStrategy, string> = {
  force: '强制覆盖 (-f)',
  skip: '跳过已有目标 (-n)',
  update: '仅处理源项目较新 (-u)',
}

export default function UploadConfirmDialog({
  selection,
  busy,
  onConfirm,
  onCancel,
}: {
  selection: UploadSelection
  busy: boolean
  onConfirm: (strategy: OperationExecutionStrategy) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const [confirmedStrategy, setConfirmedStrategy] = useState<OperationExecutionStrategy>('force')
  const needsConflictChoice = selection.strategy === 'confirm'
  const strategy: OperationExecutionStrategy = selection.strategy === 'confirm' ? confirmedStrategy : selection.strategy

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="modal operation-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">上传确认</div>
            <h2 id={titleId}>确认上传</h2>
          </div>
          <button className="icon-button modal-close" title="取消" aria-label="取消" disabled={busy} onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="operation-action-summary">
          <span>{selection.name}</span>
          <span>目标 {selection.remoteRoot}</span>
          <span>文件和目录 {selection.items.length} 项</span>
        </div>
        {needsConflictChoice && <fieldset className="operation-conflict-policy" disabled={busy}>
          <legend>遇到同名目标时选择处理方式</legend>
          <label><input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'force'} onChange={() => setConfirmedStrategy('force')} />全部覆盖</label>
          <label><input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'skip'} onChange={() => setConfirmedStrategy('skip')} />全部跳过</label>
        </fieldset>}
        {!needsConflictChoice && <p className="operation-strategy-label">策略：{strategyLabels[strategy]}</p>}
        {selection.failures.length > 0 && <div className="operation-conflict-list" aria-label="无法上传的项目">
          {selection.failures.slice(0, 6).map((failure) => <div key={failure.path}><span>{failure.path}</span><span>{failure.message}</span></div>)}
          {selection.failures.length > 6 && <p>另有 {selection.failures.length - 6} 项无法上传</p>}
        </div>}
        <details className="operation-command-preview">
          <summary>执行命令</summary>
          <code>{selection.commandPreviews[strategy]}</code>
        </details>
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus={busy || selection.items.length === 0} disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" autoFocus={!busy && selection.items.length > 0} disabled={busy || selection.items.length === 0} onClick={() => onConfirm(strategy)}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {busy ? '正在上传' : '确认上传'}
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}
