import { useId } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { UploadSelection } from '@shared/types'

export default function UploadConfirmDialog({ selection, onConfirm, onCancel }: {
  selection: UploadSelection
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="modal upload-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">上传文件</div>
            <h2 id={titleId}>文件已存在</h2>
          </div>
          <button className="icon-button modal-close" title="取消" aria-label="取消" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="operation-action-summary">
          <span>目标位置已存在以下名称：</span>
          <span>上传到：{selection.remoteRoot}</span>
        </div>
        <div className="operation-conflict-list" aria-label="已存在的名称">
          {selection.conflicts.slice(0, 6).map((path) => <div key={path}><span>{path.slice(selection.remoteRoot === '/' ? 1 : selection.remoteRoot.length + 1) || path}</span></div>)}
          {selection.conflicts.length > 6 && <p>还有 {selection.conflicts.length - 6} 个同名文件</p>}
        </div>
        <p className="confirmation-description">覆盖将替换已有文件并继续上传；取消将停止本次上传。</p>
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus onClick={onCancel}>取消</button>
          <button type="button" className="primary-button" onClick={onConfirm}>覆盖</button>
        </div>
      </section>
    </div>
  ), document.body)
}
