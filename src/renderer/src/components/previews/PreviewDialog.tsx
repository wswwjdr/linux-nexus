import type { RefObject, SyntheticEvent, WheelEvent } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import type { ImagePreviewSize, PreviewDialog as PreviewDialogState } from '@/app-types'
import ImagePreviewPanel from './ImagePreviewPanel'
import MarkdownPreviewPanel from './MarkdownPreviewPanel'
import MediaPreviewPanel from './MediaPreviewPanel'
import PdfPreviewPanel from './PdfPreviewPanel'
import TextPreviewPanel from './TextPreviewPanel'

export interface PreviewDialogProps {
  previewDialog: PreviewDialogState | null
  textDraft: string
  textDirty: boolean
  textSaving: boolean
  textSaveConfirmation: { name: string; path: string } | null
  imageZoom: number
  imagePreviewSize: ImagePreviewSize | null
  imageViewportRef: RefObject<HTMLDivElement | null>
  previewImageRef: RefObject<HTMLImageElement | null>
  onClosePreview: () => void
  onUpdateTextDraft: (content: string) => void
  onRequestTextSave: () => void
  onOpenExternalLink: (url: string) => void
  onPreviewImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onZoomPreviewImage: (event: WheelEvent<HTMLDivElement>) => void
}

export default function PreviewDialog({
  previewDialog,
  textDraft,
  textDirty,
  textSaving,
  textSaveConfirmation,
  imageZoom,
  imagePreviewSize,
  imageViewportRef,
  previewImageRef,
  onClosePreview,
  onUpdateTextDraft,
  onRequestTextSave,
  onOpenExternalLink,
  onPreviewImageLoad,
  onZoomPreviewImage,
}: PreviewDialogProps) {
  if (!previewDialog) return null
  const result = previewDialog.kind === 'ready' ? previewDialog.result : null
  const previewName = previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name
  const textPreview = result?.type === 'text'
  const markdownPreview = result?.type === 'markdown'
  const pdfPreview = result?.type === 'pdf'

  return (
    <div className={`modal-backdrop preview-backdrop${pdfPreview ? ' pdf-preview-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !textSaving && !textSaveConfirmation && onClosePreview()}>
      <section className={`modal preview-modal${result ? ` media-preview-modal${textPreview ? ' text-preview-modal' : ''}${markdownPreview ? ' markdown-preview-modal' : ''}${pdfPreview ? ' pdf-preview-modal' : ''}` : ''}`} role="dialog" aria-modal="true" aria-labelledby="preview-modal-title">
        <div className="modal-heading">
          <div>
            <h2 id="preview-modal-title">{previewName}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" disabled={textSaving || Boolean(textSaveConfirmation)} onClick={onClosePreview}><X size={18} /></button>
        </div>
        {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取文件</div>}
        {result?.type === 'text' && (
          <TextPreviewPanel
            draft={textDraft}
            dirty={textDirty}
            saving={textSaving}
            saveConfirmationOpen={Boolean(textSaveConfirmation)}
            onUpdateDraft={onUpdateTextDraft}
            onRequestSave={onRequestTextSave}
          />
        )}
        {result?.type === 'markdown' && (
          <MarkdownPreviewPanel content={result.content} onOpenExternalLink={onOpenExternalLink} />
        )}
        {result?.type === 'pdf' && <PdfPreviewPanel name={result.name} url={result.url} />}
        {result?.type === 'image' && (
          <ImagePreviewPanel
            result={result}
            zoom={imageZoom}
            imageSize={imagePreviewSize}
            viewportRef={imageViewportRef}
            imageRef={previewImageRef}
            onImageLoad={onPreviewImageLoad}
            onZoom={onZoomPreviewImage}
          />
        )}
        {(result?.type === 'audio' || result?.type === 'video') && <MediaPreviewPanel result={result} />}
      </section>
    </div>
  )
}
