import { msg, renderMessage, type MessageValue, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { FileTypeCategory } from '@shared/types'
import { normalizeFileTypeExtension } from '@shared/file-type-registry'

export function FileTypeCategoryEditor({
  label,
  capabilityDescription,
  category,
  extensions,
  onAdd,
  onRemove,
}: {
  label: string
  capabilityDescription: string
  category: FileTypeCategory
  extensions: string[]
  onAdd: (category: FileTypeCategory, extension: string) => void
  onRemove: (category: FileTypeCategory, extension: string) => void
}) {
  useLanguage()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<MessageValue | null>(null)

  const add = () => {
    try {
      const extension = normalizeFileTypeExtension(draft)
      if (extensions.includes(extension)) {
        setError(msg('files.thisExtensionHasAlreadyBeenAdded'))
        return
      }
      onAdd(category, extension)
      setDraft('')
      setError(null)
    } catch {
      setError(msg('files.enterAValidExtensionSuchAsTxtOrTarGz'))
    }
  }

  return (
    <div className="file-type-category-row">
      <div className="file-type-category-heading">
        <div className="file-type-category-name">
          <strong>{label}</strong>
          <span>{capabilityDescription}</span>
        </div>
        <div className="file-type-category-tags">
          {extensions.map((extension) => (
            <span className="file-type-category-tag" key={extension}>
              <code>{extension}</code>
              <button type="button" title={tr('files.remove', { "extension": extension })} aria-label={tr('files.remove', { "extension": extension })} onClick={() => onRemove(category, extension)}><X size={12} /></button>
            </span>
          ))}
        </div>
      </div>
      <div className="file-type-category-add">
        <input
          value={draft}
          aria-label={tr('files.addExtension', { "label": label })}
          placeholder={tr('files.addAnExtensionEGTxt')}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="icon-button" title={tr('files.addExtension2')} aria-label={tr('files.addExtension2')} disabled={!draft.trim()} onClick={add}><Plus size={15} /></button>
      </div>
      {error && <span className="file-type-category-error" role="alert">{renderMessage(error)}</span>}
    </div>
  )
}
export default FileTypeCategoryEditor
