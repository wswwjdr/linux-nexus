import type { KeyboardEvent } from 'react'
import { LoaderCircle, Save } from 'lucide-react'

interface TextPreviewPanelProps {
  draft: string
  dirty: boolean
  saving: boolean
  saveConfirmationOpen: boolean
  onUpdateDraft: (content: string) => void
  onRequestSave: () => void
}

export default function TextPreviewPanel({
  draft,
  dirty,
  saving,
  saveConfirmationOpen,
  onUpdateDraft,
  onRequestSave,
}: TextPreviewPanelProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    onRequestSave()
  }

  return (
    <>
      <textarea
        className="preview-text text-preview-editor"
        aria-label="文本内容"
        autoCapitalize="none"
        autoCorrect="off"
        disabled={saving || saveConfirmationOpen}
        spellCheck={false}
        value={draft}
        onChange={(event) => onUpdateDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="text-preview-footer">
        <span className={dirty ? 'text-preview-status modified' : 'text-preview-status'} aria-live="polite">
          {saving ? '正在保存' : dirty ? '有未保存修改' : '已保存'}
        </span>
        <button type="button" className="primary-button text-preview-save" disabled={!dirty || saving || saveConfirmationOpen} onClick={onRequestSave}>
          {saving ? <LoaderCircle className="spin" size={15} /> : <Save size={15} />}
          {saving ? '保存中' : '保存'}
        </button>
      </div>
    </>
  )
}
