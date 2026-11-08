import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import type { Ref, RefObject } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import type { LogPreviewDialog as LogPreviewDialogState } from '@/app-types'
import LogPreviewPanel from './LogPreviewPanel'
import type { PreviewSearchHandle } from './usePreviewSearch'

export interface LogPreviewDialogProps {
  logPreviewDialog: LogPreviewDialogState | null
  logViewportRef: RefObject<HTMLPreElement | null>
  textSearchRef?: Ref<PreviewSearchHandle>
  onClosePreview: () => void
  onLogPreviewScroll: () => void
}

export default function LogPreviewDialog({
  logPreviewDialog,
  logViewportRef,
  textSearchRef,
  onClosePreview,
  onLogPreviewScroll,
}: LogPreviewDialogProps) {
  useLanguage()
  if (!logPreviewDialog) return null

  return (
    <div className="modal-backdrop preview-backdrop log-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClosePreview()}>
      <section className="modal preview-modal log-preview-modal" role="dialog" aria-labelledby="log-preview-title">
        <div className="modal-heading">
          <div>
            <h2 id="log-preview-title">{logPreviewDialog.name}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('previews.closePreview')} aria-label={tr('previews.closePreview')} onClick={onClosePreview}><X size={18} /></button>
        </div>
        {logPreviewDialog.kind === 'loading' && (
          <div className="preview-loading"><LoaderCircle className="spin" size={20} />{tr('previews.readingLog')}</div>
        )}
        {logPreviewDialog.kind === 'ready' && (
          <LogPreviewPanel ref={textSearchRef} dialog={logPreviewDialog} viewportRef={logViewportRef} onScroll={onLogPreviewScroll} />
        )}
      </section>
    </div>
  )
}
