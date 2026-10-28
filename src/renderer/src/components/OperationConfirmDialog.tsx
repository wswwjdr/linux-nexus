import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { OperationExecutionStrategy, OperationPreflight } from '@shared/types'

export default function OperationConfirmDialog({
  preflight,
  busy,
  onConfirm,
  onCancel,
}: {
  preflight: OperationPreflight
  busy: boolean
  onConfirm: (strategy: OperationExecutionStrategy) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const [confirmedStrategy, setConfirmedStrategy] = useState<OperationExecutionStrategy>('force')
  const needsConflictChoice = preflight.strategy === 'confirm' && preflight.conflicts.length > 0
  const selectedStrategy = needsConflictChoice ? confirmedStrategy : preflight.strategy === 'confirm' ? 'force' : preflight.strategy
  const label = preflight.operation === 'copy' ? '复制' : preflight.operation === 'move' ? '移动' : '解压'
  const isExtract = preflight.operation === 'extract'
  const sourceLabel = isExtract ? '压缩包' : '来源项目'
  const sourcePaths = isExtract ? [preflight.archivePath!] : preflight.sourcePaths
  const destination = isExtract ? preflight.outputDirectory! : preflight.targetDirectory
  const command = preflight.commandPreviews[selectedStrategy]
  const visibleConflicts = preflight.conflicts.slice(0, 8)
  const strategyDescription = selectedStrategy === 'force'
    ? '同名时覆盖目标项目（-f）'
    : selectedStrategy === 'skip'
      ? '同名时保留目标项目并跳过（-n）'
      : '仅在来源较新时更新目标（-u）'

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busy) onCancel()
    }

    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [busy, onCancel])

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onCancel()}>
      <section className="modal operation-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">操作前确认</div>
            <h2 id={titleId}>确认{label}</h2>
          </div>
          <button className="icon-button modal-close" title="取消" aria-label="取消" disabled={busy} onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="operation-action-summary">
          <p>{isExtract ? '将解压这个压缩包到：' : `将以下 ${sourcePaths.length} 个项目${label}到：`}</p>
          <code className="operation-destination">{destination}</code>
          <div className="operation-source-list">
            <div className="operation-section-heading">{sourceLabel}（{sourcePaths.length} 项）</div>
            <ul>
              {sourcePaths.map((path) => <li key={path}><code>{path}</code></li>)}
            </ul>
          </div>
        </div>
        {needsConflictChoice && <fieldset className="operation-conflict-policy" disabled={busy}>
          <legend>目标中有同名项目，选择处理方式</legend>
          <label>
            <input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'force'} onChange={() => setConfirmedStrategy('force')} />
            <span><strong>覆盖同名项目</strong><small>替换目标中已有的同名内容。</small></span>
          </label>
          <label>
            <input type="radio" name={titleId + '-policy'} checked={confirmedStrategy === 'skip'} onChange={() => setConfirmedStrategy('skip')} />
            <span><strong>跳过同名项目</strong><small>保留目标中的内容，不处理这些项目。</small></span>
          </label>
        </fieldset>}
        {!needsConflictChoice && <p className="operation-strategy-label">
          {preflight.conflicts.length > 0
            ? `遇到同名项目时：${strategyDescription}。`
            : '预检未发现同名项目。'}
        </p>}
        {visibleConflicts.length > 0 && <div className="operation-conflict-section" aria-label="同名项目">
          <div className="operation-section-heading">目标中已有同名项目（{preflight.conflicts.length} 项）</div>
          <div className="operation-conflict-list">
            {visibleConflicts.map((conflict) => <div className="operation-conflict-item" key={conflict.sourcePath + '\0' + conflict.targetPath}>
              <div><span>来源</span><code>{conflict.sourcePath}</code></div>
              <div><span>目标已有</span><code>{conflict.targetPath}</code></div>
            </div>)}
          </div>
          {preflight.conflicts.length > visibleConflicts.length && <p>另有 {preflight.conflicts.length - visibleConflicts.length} 项未显示</p>}
        </div>}
        <details className="operation-command-preview">
          <summary>查看将发送到服务器的命令</summary>
          <code>{command}</code>
        </details>
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus={busy} disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" autoFocus={!busy} disabled={busy} onClick={() => onConfirm(selectedStrategy)}>
            {busy ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            {busy ? `正在${label}` : `确认${label}`}
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}
