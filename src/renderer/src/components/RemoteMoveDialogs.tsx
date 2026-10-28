import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Check, File, Folder, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteCopyResult, RemoteMoveConflict, RemoteMoveDecision, RemoteMoveResult } from '@shared/types'
import { RemoteConflictDialog, type RemoteConflictDialogChoice } from './RemoteConflictDialog'

const itemTypeLabel = (type: 'file' | 'directory') => type === 'directory' ? '文件夹' : '文件'

export function RemoteMoveConflictDialog({
  conflict,
  busy,
  onDecision,
  operation = 'move',
}: {
  conflict: RemoteMoveConflict
  busy: boolean
  onDecision: (decision: RemoteMoveDecision) => void
  operation?: 'move' | 'copy'
}) {
  const mismatch = conflict.conflictType === 'type-mismatch'
  const label = operation === 'copy' ? '复制' : '移动'
  const renamedSourceExample = conflict.sourceType === 'directory' ? '文件夹名 (2)' : '文件名 (2).扩展名'
  const mismatchDescription = operation === 'copy'
    ? `复制会保留现有目标，并在目标目录中创建“${renamedSourceExample}”。`
    : `移动会保留现有目标，并将来源移至目标目录，名称改为“${renamedSourceExample}”。`
  const choices: RemoteConflictDialogChoice[] = mismatch
    ? [
        { decision: 'rename', label: '自动重命名来源项' },
        { decision: 'skip', label: '跳过此项' },
      ]
    : [
        { decision: 'skip', label: '跳过此文件' },
        { decision: 'replace', label: '覆盖此文件' },
        { decision: 'rename', label: '自动重命名' },
      ]
  const batchDecisions: Record<RemoteConflictDialogChoice['decision'], RemoteMoveDecision> = {
    replace: 'replace-all',
    skip: 'skip-all',
    rename: 'rename-all',
  }
  return <RemoteConflictDialog
    key={conflict.conflictId}
    heading={`远程${label}冲突`}
    title={mismatch ? '同名项目类型不同' : '目标文件已存在'}
    sourceLabel="来源"
    sourcePath={conflict.sourcePath}
    targetPath={conflict.targetPath}
    sourceType={conflict.sourceType}
    targetType={conflict.targetType}
    description={mismatch
      ? `来源是${itemTypeLabel(conflict.sourceType)}，目标是${itemTypeLabel(conflict.targetType)}。${mismatchDescription}此类冲突需单独处理，不应用批量设置。`
      : '可覆盖、跳过或自动重命名此文件（名称 (2).扩展名）。覆盖会替换目标文件内容。“应用到全部文件”会将所选动作应用于本次操作当前及后续所有普通文件冲突，包括文件夹内部的文件。'}
    actions={[]}
    choices={choices}
    defaultChoice={mismatch ? 'rename' : 'replace'}
    applyToAllLabel={mismatch ? undefined : '应用到全部文件'}
    cancelLabel={`取消${label}`}
    onConfirmChoice={(decision, applyToAll) => {
      onDecision(applyToAll && !mismatch ? batchDecisions[decision] : decision)
    }}
    busy={busy}
    onDecision={(decision) => onDecision(decision as RemoteMoveDecision)}
  />
}

export function RemoteMoveSummaryDialog({
  result,
  onClose,
  operation = 'move',
}: {
  result: RemoteMoveResult | RemoteCopyResult
  onClose: () => void
  operation?: 'move' | 'copy'
}) {
  const titleId = useId()
  const failures = result.results.filter((item) => item.status === 'failed' || item.status === 'cancelled')
  const copied = operation === 'copy' ? (result as RemoteCopyResult).copiedCount : (result as RemoteMoveResult).movedCount
  const label = operation === 'copy' ? '复制' : '移动'

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [onClose])

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop remote-move-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal remote-move-summary" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className={'confirmation-icon ' + (result.failedCount > 0 ? 'warning' : 'success')}>
            {result.failedCount > 0 ? <AlertTriangle size={19} /> : <Check size={19} />}
          </div>
          <div className="confirmation-title-group">
            <div className="modal-kicker">远程{label}</div>
            <h2 id={titleId}>{result.status === 'cancelled' ? `${label}已取消` : `${label}完成`}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="remote-move-summary-counts" aria-label={`${label}结果`}>
          <span><strong>{copied}</strong> 已{label}</span>
          <span><strong>{result.skippedCount}</strong> 已跳过</span>
          <span><strong>{result.failedCount}</strong> 失败</span>
          {result.cancelledCount > 0 && <span><strong>{result.cancelledCount}</strong> 未完成</span>}
        </div>
        {failures.length > 0 && (
          <div className="remote-move-result-list" role="list" aria-label="未完成项目">
            {failures.map((item) => (
              <div className="remote-move-result-item" role="listitem" key={item.sourcePath}>
                <strong>{item.sourceName}</strong>
                <span>{item.message ?? (item.status === 'cancelled' ? '已取消' : `${label}失败`)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="modal-footer">
          <button type="button" className="primary-button" autoFocus onClick={onClose}>完成</button>
        </div>
      </section>
    </div>
  ), document.body)
}
