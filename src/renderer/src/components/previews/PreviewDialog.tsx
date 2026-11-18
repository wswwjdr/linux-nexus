import { useLanguage } from '@/i18n'
import { tr } from '@shared/i18n/messages'
import { useId, useRef, type KeyboardEvent, type Ref } from 'react'
import { ChevronUp, FileText, LoaderCircle, RefreshCw, Save, X } from 'lucide-react'
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
  onReopenText: (encoding: TextEncoding) => void
  textDraft: string
  textDirty: boolean
  textSaving: boolean
  textConflictOpen: boolean
  textSearchRef?: Ref<PreviewSearchHandle>
  onClosePreview: () => void
  onUpdateTextDraft: (content: string) => void
  onRequestTextSave: (encoding?: TextEncoding) => void
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
  textReloading,
  onReopenText,
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
  const encodingMenuId = useId()
  const encodingMenuRef = useRef<HTMLDivElement>(null)
  if (!previewDialog) return null
  const result = previewDialog.kind === 'ready' ? previewDialog.result : null
  const previewName = previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name
  const textResult = result?.type === 'text' ? result : null
  const pdfPreview = result?.type === 'pdf'
  const textBusy = textSaving || textReloading || textConflictOpen
  const encodingLabel = textResult?.encoding === 'gbk' ? 'GBK' : textResult?.bom ? 'UTF-8 BOM' : 'UTF-8'
  const alternateEncoding = textResult?.encoding === 'gbk' ? 'utf8' : 'gbk'
  const alternateEncodingLabel = alternateEncoding === 'utf8' ? 'UTF-8' : 'GBK'

  /**
   * Closes the encoding popover before reloading or saving the file.
   * @param action Operation to run with the alternate encoding.
   */
  const applyAlternateEncoding = (action: (encoding: TextEncoding) => void) => {
    encodingMenuRef.current!.hidePopover()
    action(alternateEncoding)
  }

  /**
   * Dismisses the encoding popover before Escape reaches search or preview shortcuts.
   * @param event Keyboard event originating in the preview.
   */
  const closeEncodingOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    const menu = encodingMenuRef.current
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || !menu?.matches(':popover-open')) return
    event.preventDefault()
    event.stopPropagation()
    menu.hidePopover()
  }

  if (result?.type === 'audio') {
    return <AudioPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  }

  if (result?.type === 'video') return <VideoPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'image') return <ImagePreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'markdown') return <MarkdownPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} onOpenExternalLink={onOpenExternalLink} />

  return (
    <div className={`modal-backdrop preview-backdrop${pdfPreview ? ' pdf-preview-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !textBusy && onClosePreview()}>
      <section className={`modal preview-modal${result ? ` media-preview-modal${textResult ? ' text-preview-modal' : ''}${pdfPreview ? ' pdf-preview-modal' : ''}` : ''}`}
        onKeyDownCapture={closeEncodingOnEscape}
        data-modal-size={pdfPreview ? 'reading' : textResult ? 'reading-expanded' : undefined} role="dialog" aria-labelledby="preview-modal-title">
        <div className="modal-heading">
          <div className={textResult ? 'text-preview-title' : undefined}>
            {textResult && <FileText size={20} aria-hidden="true" />}
            <h2 title={previewName} id="preview-modal-title">{previewName}</h2>
          </div>
          <button className="icon-button modal-close" title={tr('previews.closePreview')} aria-label={tr('previews.closePreview')} disabled={textBusy} onClick={onClosePreview}><X size={18} /></button>
        </div>
        {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} />{tr('previews.readingFile')}</div>}
        {textResult && (
          <TextPreviewPanel
            ref={textSearchRef}
            encodingControls={active && (
              <>
                <button type="button" className="text-preview-encoding" popoverTarget={encodingMenuId} disabled={textBusy}
                  aria-label={tr('previews.currentTextEncoding', { encoding: encodingLabel })}>
                  {encodingLabel}<ChevronUp size={12} aria-hidden="true" />
                </button>
                <div ref={encodingMenuRef} id={encodingMenuId} popover="auto" className="text-preview-encoding-menu"
                  role="group" aria-label={tr('previews.encodingSettings')}>
                  <button type="button" disabled={textBusy} onClick={() => applyAlternateEncoding(onReopenText)}>
                    <RefreshCw size={14} aria-hidden="true" />{tr('previews.reloadWithEncoding', { encoding: alternateEncodingLabel })}
                  </button>
                  <button type="button" disabled={textBusy} onClick={() => applyAlternateEncoding(onRequestTextSave)}>
                    <Save size={14} aria-hidden="true" />{tr('previews.saveWithEncoding', { encoding: alternateEncodingLabel })}
                  </button>
                </div>
              </>
            )}
            reloading={textReloading}
            draft={textDraft}
            dirty={textDirty}
            saving={textSaving}
            conflictOpen={textConflictOpen}
            lossy={textResult.lossy}
            onUpdateDraft={onUpdateTextDraft}
            onRequestSave={() => onRequestTextSave()}
          />
        )}
        {result?.type === 'pdf' && <PdfPreviewPanel name={result.name} url={result.url} />}
      </section>
    </div>
  )
}
