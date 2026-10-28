import { useId, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { OperationExecutionStrategy, UploadPreflight } from '@shared/types'

const strategyLabels: Record<OperationExecutionStrategy, string> = {
  force: '强制覆盖 (-f)',
  skip: '跳过已有目标 (-n)',
  update: '仅处理源项目较新 (-u)',
}

export default function UploadConfirmDialog({
  preflight,
  busy,
  onConfirm,
  onCancel,
}: {
  preflight: UploadPreflight
  busy: boolean
  onConfirm: (strategy: OperationExecutionStrategy) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const [confirmedStrategy, setConfirmedStrategy] = useState<OperationExecutionStrategy>('force')
  const needsConflictChoice = preflight.strategy === 'confirm' && preflight.conflicts.length > 0
  const strategy = needsConflictChoice ? confirmedStrategy : preflight.strategy === 'confirm' ? 'force' : preflight.strategy
  const visibleConflicts = preflight.conflicts.slice(0, 8)

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="modal operation-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">服务器上传预检</div>
            <h2 id={titleId}>确认上传</h2>
          </div>
          <button className="icon-button modal-close" title="取消" aria-label="取消" disabled={busy} onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="operation-preflight-summary">
          <span>{preflight.name}</span>
          <span>目标 {preflight.remoteRoot}</span>
          <span>文件和目录 {preflight.items.length} 项</span>
          <span>重名 {preflight.conflicts.length} 项</span>
        </div>
        {needsConflictChoice && <fieldset className="operation-conflict-policy" disabled={busy}>
          <legend>检测到同名目标，选择统一处理方式</legend>
          <label><input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'force'} onChange={() => setConfirmedStrategy('force')} />全部覆盖</label>
          <label><input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'skip'} onChange={() => setConfirmedStrategy('skip')} />全部跳过</label>
        </fieldset>}
        {!needsConflictChoice && <p className="operation-strategy-label">策略：{strategyLabels[strategy]}</p>}
        {visibleConflicts.length > 0 && <div className="operation-conflict-list" aria-label="冲突项目">
          {visibleConflicts.map((conflict) => <div key={conflict.sourcePath + '\0' + conflict.targetPath}>
            <span>{conflict.sourcePath}</span><span>{conflict.targetPath}</span>
          </div>)}
          {preflight.conflicts.length > visibleConflicts.length && <p>另有 {preflight.conflicts.length - visibleConflicts.length} 项冲突</p>}
        </div>}
        {preflight.failures.length > 0 && <div className="operation-conflict-list" aria-label="无法上传的项目">
          {preflight.failures.slice(0, 6).map((failure) => <div key={failure.path}><span>{failure.path}</span><span>{failure.message}</span></div>)}
          {preflight.failures.length > 6 && <p>另有 {preflight.failures.length - 6} 项无法上传</p>}
        </div>}
        <details className="operation-command-preview">
          <summary>执行命令</summary>
          <code>{preflight.commandPreviews[strategy]}</code>
        </details>
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus={busy || preflight.items.length === 0} disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" autoFocus={!busy && preflight.items.length > 0} disabled={busy || preflight.items.length === 0} onClick={() => onConfirm(strategy)}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {busy ? '正在准备' : '执行上传'}
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}
