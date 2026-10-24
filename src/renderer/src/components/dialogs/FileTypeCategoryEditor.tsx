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
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const add = () => {
    try {
      const extension = normalizeFileTypeExtension(draft)
      if (extensions.includes(extension)) {
        setError('此后缀已添加')
        return
      }
      onAdd(category, extension)
      setDraft('')
      setError(null)
    } catch {
      setError('请输入有效后缀，例如 .txt 或 .tar.gz')
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
              <button type="button" title={'移除 ' + extension} aria-label={'移除 ' + extension} onClick={() => onRemove(category, extension)}><X size={12} /></button>
            </span>
          ))}
        </div>
      </div>
      <div className="file-type-category-add">
        <input
          value={draft}
          aria-label={'添加' + label + '后缀'}
          placeholder="添加后缀，如 .txt"
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
        <button type="button" className="icon-button" title="添加后缀" aria-label="添加后缀" disabled={!draft.trim()} onClick={add}><Plus size={15} /></button>
      </div>
      {error && <span className="file-type-category-error" role="alert">{error}</span>}
    </div>
  )
}
export default FileTypeCategoryEditor
