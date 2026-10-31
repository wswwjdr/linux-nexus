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
  onConvertTextToUtf8: () => void
  textDraft: string
  textDirty: boolean
  textSaving: boolean
  textSaveConfirmation: { name: string; path: string } | null
  textSearchRef?: Ref<PreviewSearchHandle>
  onClosePreview: () => void
  onUpdateTextDraft: (content: string) => void
  onRequestTextSave: () => void
  onOpenExternalLink: (url: string) => void
}

export default function PreviewDialog({
  active,
  previewDialog,
  textReloading, textEncoding, onReopenText, onConvertTextToUtf8,
  textDraft,
  textDirty,
  textSaving,
  textSaveConfirmation,
  textSearchRef,
  onClosePreview,
  onUpdateTextDraft,
  onRequestTextSave,
  onOpenExternalLink,
}: PreviewDialogProps) {
  if (!previewDialog) return null
  const result = previewDialog.kind === 'ready' ? previewDialog.result : null
  const previewName = previewDialog.kind === 'ready' ? previewDialog.result.name : previewDialog.name
  const textPreview = result?.type === 'text'
  const pdfPreview = result?.type === 'pdf'

  if (result?.type === 'audio') {
    return <AudioPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  }

  if (result?.type === 'video') return <VideoPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'image') return <ImagePreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} />
  if (result?.type === 'markdown') return <MarkdownPreviewDialog key={result.token} result={result} active={active} onClose={onClosePreview} onOpenExternalLink={onOpenExternalLink} />

  return (
    <div className={`modal-backdrop preview-backdrop${pdfPreview ? ' pdf-preview-backdrop' : ''}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !textSaving && !textSaveConfirmation && onClosePreview()}>
      <section className={`modal preview-modal${result ? ` media-preview-modal${textPreview ? ' text-preview-modal' : ''}${pdfPreview ? ' pdf-preview-modal' : ''}` : ''}`} role="dialog" aria-labelledby="preview-modal-title">
        <div className="modal-heading">
          <div>
            <h2 id="preview-modal-title">{previewName}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" disabled={textSaving || textReloading || Boolean(textSaveConfirmation)} onClick={onClosePreview}><X size={18} /></button>
        </div>
        {previewDialog.kind === 'loading' && <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取文件</div>}
        {result?.type === 'text' && <div className="text-encoding-toolbar">
          <span>保存编码：{textEncoding === 'utf8' ? 'UTF-8' : 'GBK'}{result.bom && textEncoding === 'utf8' ? ' BOM' : ''}</span>
          <button disabled={textSaving || textReloading || Boolean(textSaveConfirmation)} onClick={() => onReopenText('utf8')}>以 UTF-8 重新加载</button>
          <button disabled={textSaving || textReloading || Boolean(textSaveConfirmation)} onClick={() => onReopenText('gbk')}>以 GBK 重新加载</button>
          {textEncoding === 'gbk' && <button disabled={textSaving || textReloading || Boolean(textSaveConfirmation)} onClick={onConvertTextToUtf8}>转换为 UTF-8</button>}
        </div>}
        {result?.type === 'text' && (
          <TextPreviewPanel
            ref={textSearchRef}
            draft={textDraft}
            dirty={textDirty}
            saving={textSaving || textReloading}
            saveConfirmationOpen={Boolean(textSaveConfirmation)}
            onUpdateDraft={onUpdateTextDraft}
            onRequestSave={onRequestTextSave}
          />
        )}
        {result?.type === 'pdf' && <PdfPreviewPanel name={result.name} url={result.url} />}
      </section>
    </div>
  )
}
