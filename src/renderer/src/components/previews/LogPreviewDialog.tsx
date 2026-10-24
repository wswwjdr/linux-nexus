import type { RefObject } from 'react'
import { FileText, LoaderCircle, X } from 'lucide-react'
import type { LogPreviewDialog as LogPreviewDialogState } from '@/app-types'

export interface LogPreviewDialogProps {
  logPreviewDialog: LogPreviewDialogState | null
  logViewportRef: RefObject<HTMLPreElement | null>
  onClosePreview: () => void
  onLogPreviewScroll: () => void
}

export default function LogPreviewDialog({
  logPreviewDialog,
  logViewportRef,
  onClosePreview,
  onLogPreviewScroll,
}: LogPreviewDialogProps) {
  if (!logPreviewDialog) return null

  return (
    <div className="modal-backdrop preview-backdrop log-preview-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClosePreview()}>
      <section className="modal preview-modal log-preview-modal" role="dialog" aria-labelledby="log-preview-title">
        <div className="modal-heading">
          <div>
            <div className="modal-kicker"><FileText size={14} /> 倒序预览</div>
            <h2 id="log-preview-title">{logPreviewDialog.name}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭预览" aria-label="关闭预览" onClick={onClosePreview}><X size={18} /></button>
        </div>
        {logPreviewDialog.kind === 'loading' && (
          <div className="preview-loading"><LoaderCircle className="spin" size={20} /> 正在读取日志</div>
        )}
        {logPreviewDialog.kind === 'ready' && (
          <>
            <div className="log-preview-status" aria-live="polite">
              {logPreviewDialog.loadingEarlier
                ? <><LoaderCircle className="spin" size={14} /> 正在读取更早内容</>
                : !logPreviewDialog.hasEarlier
                  ? logPreviewDialog.startOffset === 0 ? '已到文件开头' : '已达到文本预览上限'
                  : ''}
            </div>
            <pre ref={logViewportRef} className="preview-text log-preview-text" tabIndex={0} onScroll={onLogPreviewScroll}>{logPreviewDialog.content}</pre>
          </>
        )}
      </section>
    </div>
  )
}
