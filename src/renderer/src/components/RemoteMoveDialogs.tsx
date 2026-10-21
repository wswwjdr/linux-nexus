import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Check, File, Folder, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteMoveConflict, RemoteMoveDecision, RemoteMoveResult } from '@shared/types'

const itemTypeLabel = (type: 'file' | 'directory') => type === 'directory' ? '文件夹' : '文件'

export function RemoteMoveConflictDialog({
  conflict,
  busy,
  onDecision,
}: {
  conflict: RemoteMoveConflict
  busy: boolean
  onDecision: (decision: RemoteMoveDecision) => void
}) {
  const titleId = useId()
  const mismatch = conflict.conflictType === 'type-mismatch'
  const TargetIcon = conflict.targetType === 'directory' ? Folder : File

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busy) onDecision('cancel')
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [busy, onDecision])

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop remote-move-backdrop" role="presentation">
      <section className="modal remote-move-conflict" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">远程移动冲突</div>
            <h2 id={titleId}>{mismatch ? '同名项目类型不同' : '目标文件已存在'}</h2>
          </div>
          <button className="icon-button modal-close" title="取消移动" aria-label="取消移动" disabled={busy} onClick={() => onDecision('cancel')}><X size={18} /></button>
        </div>
        <dl className="confirmation-details">
          <div className="confirmation-detail">
            <dt>来源</dt>
            <dd><span className="remote-move-item-icon">{conflict.sourceType === 'directory' ? <Folder size={15} /> : <File size={14} />}</span>{conflict.sourcePath}</dd>
          </div>
          <div className="confirmation-detail">
            <dt>目标</dt>
            <dd><span className="remote-move-item-icon">{<TargetIcon size={15} />}</span>{conflict.targetPath}</dd>
          </div>
        </dl>
        <p className="confirmation-description">
          {mismatch
            ? `来源是${itemTypeLabel(conflict.sourceType)}，目标是${itemTypeLabel(conflict.targetType)}。替换会先删除整个目标${itemTypeLabel(conflict.targetType)}及其内容，此操作无法撤销。`
            : '覆盖会永久删除目标文件的现有内容，此操作无法撤销。'}
        </p>
        <div className="remote-move-conflict-actions">
          {mismatch ? (
            <>
              <button type="button" className="danger-button" disabled={busy} onClick={() => onDecision('replace')}>
                {busy ? <LoaderCircle className="spin" size={15} /> : <AlertTriangle size={15} />}删除目标并替换
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision('skip')}>跳过此项</button>
              <button type="button" className="secondary-button remote-move-cancel" disabled={busy} onClick={() => onDecision('cancel')}>取消移动</button>
            </>
          ) : (
            <>
              <button type="button" className="danger-button" disabled={busy} onClick={() => onDecision('replace')}>
                {busy ? <LoaderCircle className="spin" size={15} /> : <AlertTriangle size={15} />}覆盖此文件
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision('skip')}>跳过此文件</button>
              <button type="button" className="warning-button" disabled={busy} onClick={() => onDecision('replace-all')}>后续均覆盖</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onDecision('skip-all')}>后续均跳过</button>
              <button type="button" className="secondary-button remote-move-cancel" disabled={busy} onClick={() => onDecision('cancel')}>取消移动</button>
            </>
          )}
        </div>
      </section>
    </div>
  ), document.body)
}

export function RemoteMoveSummaryDialog({
  result,
  onClose,
}: {
  result: RemoteMoveResult
  onClose: () => void
}) {
  const titleId = useId()
  const failures = result.results.filter((item) => item.status === 'failed' || item.status === 'cancelled')

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
            <div className="modal-kicker">远程移动</div>
            <h2 id={titleId}>{result.status === 'cancelled' ? '移动已取消' : '移动完成'}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="remote-move-summary-counts" aria-label="移动结果">
          <span><strong>{result.movedCount}</strong> 已移动</span>
          <span><strong>{result.skippedCount}</strong> 已跳过</span>
          <span><strong>{result.failedCount}</strong> 失败</span>
          {result.cancelledCount > 0 && <span><strong>{result.cancelledCount}</strong> 未完成</span>}
        </div>
        {failures.length > 0 && (
          <div className="remote-move-result-list" role="list" aria-label="未完成项目">
            {failures.map((item) => (
              <div className="remote-move-result-item" role="listitem" key={item.sourcePath}>
                <strong>{item.sourceName}</strong>
                <span>{item.message ?? (item.status === 'cancelled' ? '已取消' : '移动失败')}</span>
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
