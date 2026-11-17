import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import type { Ref } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import type { PreviewDialog as PreviewDialogState } from '@/app-types'
import ImagePreviewDialog from './image/ImagePreviewDialog'
import MarkdownPreviewDialog from './markdown/MarkdownPreviewDialog'
import AudioPreviewDialog from './audio/AudioPreviewDialog'
import VideoPreviewDialog from './video/VideoPreviewDialog'
import PdfPreviewPanel from './PdfPreviewPanel'
import TextPreviewPanel from './TextPreviewPanel'
import type { TextEncoding } from '@shared/types'
import type { PreviewSearchHandle } from './usePreviewSearch'

export interface PreviewDialogProps {
  active: boolean
  previewDialog: PreviewDialogState | null
  textReloading: boolean
  textEncoding: TextEncoding
  onReopenText: (encoding: TextEncoding) => void
  onSelectTextSaveEncoding: (encoding: TextEncoding) => void
  textDraft: string
  textDirty: boolean
  textSaving: boolean
  textConflictOpen: boolean
  textSearchRef?: Ref<PreviewSearchHandle>
  onClosePreview: () => void
  onUpdateTextDraft: (content: string) => void
  onRequestTextSave: () => void
  onOpenExternalLink: (url: string) => void
}

/**
 * Displays the selected file preview and the text encoding controls when available.
 * @param props Preview state, editing controls and lifecycle handlers.
 * @returns The active preview dialog, or null when closed.
 */
export default function PreviewDialog({
  active,
  previewDialog,
  textReloading, textEncoding, onReopenText, onSelectTextSaveEncoding,
  textDraft,
  textDirty,
  textSaving,
  textConflictOpen,
  textSearchRef,
  onClosePreview,
  onUpdateTextDraft,
  onRequestTextSave,
  onOpenExternalLink,
}: PreviewDialogProps) {
  useLanguage()
  if (!previewDialog) return null
  const result = previewDialog.kind === 'ready' ? previewDialog.result : null
  const previewName = previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name
  const textPreview = result?.type === 'text'
  const pdfPreview = result?.type === 'pdf'
  const textBusy = textSaving || textReloading || textConflictOpen

  if (result?.type === 'audio') {
    return <AudioPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  }

  if (result?.type === 'video') return <VideoPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'image') return <ImagePreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'markdown') return <MarkdownPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} onOpenExternalLink={onOpenExternalLink} />

  return (
    <div className={`modal-backdrop preview-backdrop${pdfPreview ? ' pdf-preview-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !textBusy && onClosePreview()}>
      <section className={`modal preview-modal${result ? ` media-preview-modal${textPreview ? ' text-preview-modal' : ''}${pdfPreview ? ' pdf-preview-modal' : ''}` : ''}`}
        data-modal-size={pdfPreview ? 'reading' : textPreview ? 'reading-expanded' : undefined} role="dialog" aria-labelledby="preview-modal-title">
        <div className="modal-heading">
          <div>
            <h2 id="preview-modal-title">{previewName}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('previews.closePreview')} aria-label={tr('previews.closePreview')} disabled={textBusy} onClick={onClosePreview}><X size={18} /></button>
        </div>
        {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} />{tr('previews.readingFile')}</div>}
        {result?.type === 'text' && <div className="text-encoding-toolbar">
          <button disabled={textBusy} onClick={() => onReopenText('utf8')}>{tr('previews.reloadAsUtf8')}</button>
          <button disabled={textBusy} onClick={() => onReopenText('gbk')}>{tr('previews.reloadAsGbk')}</button>
          <label>
            {tr('previews.saveEncoding')}
            <select value={textEncoding} disabled={textBusy} onChange={(event) => onSelectTextSaveEncoding(event.target.value === 'gbk' ? 'gbk' : 'utf8')}>
              <option value="utf8">{result.bom ? 'UTF-8 BOM' : 'UTF-8'}</option>
              <option value="gbk">GBK</option>
            </select>
          </label>
        </div>}
        {result?.type === 'text' && (
          <TextPreviewPanel
            ref={textSearchRef}
            draft={textDraft}
            dirty={textDirty}
            saving={textSaving || textReloading}
            conflictOpen={textConflictOpen}
            lossy={result.lossy}
            onUpdateDraft={onUpdateTextDraft}
            onRequestSave={onRequestTextSave}
          />
        )}
        {result?.type === 'pdf' && <PdfPreviewPanel name={result.name} url={result.url} />}
      </section>
    </div>
  )
}
