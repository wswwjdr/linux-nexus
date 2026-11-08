import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { Check, LoaderCircle, X } from 'lucide-react'
import type { DialogLayerProps } from './types'

export function DirectoryDialogs(props: Pick<DialogLayerProps, 'createDirectoryDialog' | 'creatingDirectory' | 'onCloseCreateDirectory' | 'onUpdateCreateDirectoryName' | 'onSubmitCreateDirectory'>) {
  useLanguage()
  const { createDirectoryDialog, creatingDirectory, onCloseCreateDirectory, onUpdateCreateDirectoryName, onSubmitCreateDirectory } = props

  return createDirectoryDialog ? (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !creatingDirectory && onCloseCreateDirectory()}>
      <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="create-directory-title">
        <div className="modal-heading">
          <div>
            <h2 id="create-directory-title">{tr('common.newFolder')}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} disabled={creatingDirectory} onClick={onCloseCreateDirectory}><X size={18} /></button>
        </div>
        <form onSubmit={onSubmitCreateDirectory}>
          <label className="field">
            <span>{tr('common.name')}</span>
            <input
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              required
              disabled={creatingDirectory}
              value={createDirectoryDialog.name}
              onChange={(event) => onUpdateCreateDirectoryName(event.target.value)}
              placeholder={tr('common.folderName')}
            />
          </label>
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={creatingDirectory} onClick={onCloseCreateDirectory}>{tr('common.cancel')}</button>
            <button type="submit" className="primary-button" disabled={creatingDirectory}>
              {creatingDirectory ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {creatingDirectory ? tr('common.creating') : tr('common.create')}
            </button>
          </div>
        </form>
      </section>
    </div>
  ) : null
}
