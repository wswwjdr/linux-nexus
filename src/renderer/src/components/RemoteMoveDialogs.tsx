import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Check, File, Folder, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteCopyResult, RemoteMoveConflict, RemoteMoveDecision, RemoteMoveResult } from '@shared/types'
import { RemoteConflictDialog } from './RemoteConflictDialog'

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
  return <RemoteConflictDialog
    heading={`远程${label}冲突`}
    title={mismatch ? '同名项目类型不同' : '目标文件已存在'}
    sourceLabel="来源"
    sourcePath={conflict.sourcePath}
    targetPath={conflict.targetPath}
    sourceType={conflict.sourceType}
    targetType={conflict.targetType}
    description={mismatch
      ? `来源是${itemTypeLabel(conflict.sourceType)}，目标是${itemTypeLabel(conflict.targetType)}。替换会先删除整个目标${itemTypeLabel(conflict.targetType)}及其内容，此操作无法撤销。`
      : operation === 'copy' ? '覆盖会替换目标文件的现有内容，此操作无法撤销。' : '覆盖会永久删除目标文件的现有内容，此操作无法撤销。'}
    actions={mismatch
      ? [
          { decision: 'replace', label: operation === 'copy' ? '删除目标并复制' : '删除目标并替换', tone: 'danger' },
          { decision: 'skip', label: '跳过此项' },
          { decision: 'cancel', label: `取消${label}` },
        ]
      : [
          { decision: 'replace', label: '覆盖此文件', tone: 'danger' },
          { decision: 'skip', label: '跳过此文件' },
          { decision: 'replace-all', label: '后续均覆盖', tone: 'warning' },
          { decision: 'skip-all', label: '后续均跳过' },
          { decision: 'cancel', label: `取消${label}` },
        ]}
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
