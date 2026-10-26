import { Check, LoaderCircle, X } from 'lucide-react'
import type { DialogLayerProps } from './types'

export function DirectoryDialogs(props: Pick<DialogLayerProps, 'createDirectoryDialog' | 'creatingDirectory' | 'onCloseCreateDirectory' | 'onUpdateCreateDirectoryName' | 'onSubmitCreateDirectory'>) {
  const { createDirectoryDialog, creatingDirectory, onCloseCreateDirectory, onUpdateCreateDirectoryName, onSubmitCreateDirectory } = props

  return createDirectoryDialog ? (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !creatingDirectory && onCloseCreateDirectory()}>
      <section className="modal create-directory-modal" role="dialog" aria-modal="true" aria-labelledby="create-directory-title">
        <div className="modal-heading">
          <div>
            <h2 id="create-directory-title">新建文件夹</h2>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={creatingDirectory} onClick={onCloseCreateDirectory}><X size={18} /></button>
        </div>
        <form onSubmit={onSubmitCreateDirectory}>
          <label className="field">
            <span>名称</span>
            <input
              autoFocus
              autoCapitalize="none"
              autoComplete="off"
              required
              disabled={creatingDirectory}
              value={createDirectoryDialog.name}
              onChange={(event) => onUpdateCreateDirectoryName(event.target.value)}
              placeholder="文件夹名称"
            />
          </label>
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={creatingDirectory} onClick={onCloseCreateDirectory}>取消</button>
            <button type="submit" className="primary-button" disabled={creatingDirectory}>
              {creatingDirectory ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
              {creatingDirectory ? '创建中' : '创建'}
            </button>
          </div>
        </form>
      </section>
    </div>
  ) : null
}
