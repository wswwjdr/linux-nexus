import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useId } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { UploadSelection } from '@shared/types'

export default function UploadConfirmDialog({ selection, onConfirm, onCancel }: {
  selection: UploadSelection
  onConfirm: () => void
  onCancel: () => void
}) {
  useLanguage()
  const titleId = useId()
  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="modal upload-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><AlertTriangle size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">{tr('common.uploadFiles')}</div>
            <h2 id={titleId}>{tr('transfers.fileAlreadyExists')}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('common.cancel')} aria-label={tr('common.cancel')} onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="operation-action-summary">
          <span>{tr('transfers.theseNamesAlreadyExistAtTheDestination')}</span>
          <span>{tr('transfers.uploadTo')}{selection.remoteRoot}</span>
        </div>
        <div className="operation-conflict-list" aria-label={tr('transfers.existingNames')}>
          {selection.conflicts.slice(0, 6).map((path) => <div key={path}><span>{path.slice(selection.remoteRoot === '/' ? 1 : selection.remoteRoot.length + 1) || path}</span></div>)}
          {selection.conflicts.length > 6 && <p>{tr('transfers.moreConflicts', { count: selection.conflicts.length - 6 })}</p>}
        </div>
        <p className="confirmation-description">{tr('transfers.overwriteReplacesExistingFilesAndContinuesUploadingCancelStopsThis')}</p>
        <div className="modal-footer">
          <button type="button" className="secondary-button" autoFocus onClick={onCancel}>{tr('common.cancel')}</button>
          <button type="button" className="primary-button" onClick={onConfirm}>{tr('transfers.overwrite')}</button>
        </div>
      </section>
    </div>
  ), document.body)
}
