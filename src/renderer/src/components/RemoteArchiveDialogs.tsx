import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, ChevronRight, Folder, FolderPlus, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteEntry } from '@shared/types'
import type { ArchiveDestinationDialogState } from '../features/remote-files/useRemoteOperations'
import { errorMessage } from '@/app-utils'

function pathParts(path: string): Array<{ label: string; path: string }> {
  const segments = path.split('/').filter(Boolean)
  return [
    { label: '/', path: '/' },
    ...segments.map((segment, index) => ({ label: segment, path: '/' + segments.slice(0, index + 1).join('/') })),
  ]
}

function childPath(directory: string, name: string): string {
  return directory === '/' ? `/${name}` : `${directory}/${name}`
}

function RemoteDirectoryPicker({
  state,
  onClose,
  onChoose,
  onCreateDirectory,
}: {
  state: ArchiveDestinationDialogState
  onClose: () => void
  onChoose: (directory: string) => void
  onCreateDirectory: (directory: string, name: string) => Promise<void>
}) {
  const titleId = useId()
  const [directory, setDirectory] = useState(state.directory)
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newFolderName, setNewFolderName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    void window.remoteFiles.listDirectory(state.sessionId, directory).then((result) => {
      if (active) setEntries(result.filter((entry) => entry.type === 'directory').sort((a, b) => a.name.localeCompare(b.name)))
    }).catch((reason: unknown) => {
      if (active) setLoadError('读取目录失败：' + errorMessage(reason))
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [directory, state.sessionId])

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!creating) onClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [creating, onClose])

  const submitNewFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = newFolderName.trim()
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
      setError('文件夹名称不能为空，不能是 . 或 ..，也不能包含 / 或空字符')
      return
    }
    setCreating(true)
    setError(null)
    try {
      await onCreateDirectory(directory, name)
      setNewFolderName('')
      setEntries((current) => [...current, {
        name,
        path: childPath(directory, name),
        type: 'directory' as const,
        size: 0,
        modifiedAt: null,
        permissions: '',
      }].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (reason) {
      setError('创建文件夹失败：' + errorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  const crumbs = pathParts(directory)
  const navigateDirectory = (path: string) => {
    setError(null)
    setDirectory(path)
  }

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop remote-archive-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !creating && onClose()}>
      <section className="modal remote-directory-picker" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>选择解压位置</h2>
            <p className="remote-archive-subtitle">{state.entry.name}</p>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" disabled={creating} onClick={onClose}><X size={18} /></button>
        </div>
        <nav className="remote-directory-breadcrumbs" aria-label="远程目录路径">
          {crumbs.map((crumb, index) => (
            <span className="remote-directory-crumb" key={crumb.path}>
              {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
              <button type="button" aria-current={index === crumbs.length - 1 ? 'location' : undefined} onClick={() => navigateDirectory(crumb.path)}>{crumb.label}</button>
            </span>
          ))}
        </nav>
        <form className="remote-directory-create" onSubmit={(event) => void submitNewFolder(event)}>
          <input aria-label="新文件夹名称" autoComplete="off" value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} placeholder="新建文件夹" disabled={creating} />
          <button type="submit" className="secondary-button" disabled={creating || !newFolderName.trim()}>
            {creating ? <LoaderCircle className="spin" size={15} /> : <FolderPlus size={15} />}新建
          </button>
        </form>
        <div className="remote-directory-list" aria-label="文件夹列表" aria-busy={loading}>
          {loading ? <div className="remote-directory-empty"><LoaderCircle className="spin" size={17} />正在读取目录…</div>
            : loadError ? <div className="remote-directory-error" role="alert">{loadError}</div>
              : entries.length === 0 ? <div className="remote-directory-empty">此目录没有子文件夹</div>
                : entries.map((entry) => (
                  <button className="remote-directory-entry" type="button" key={entry.path} onClick={() => navigateDirectory(entry.path)}>
                    <Folder size={16} aria-hidden="true" /><span>{entry.name}</span><ChevronRight size={14} aria-hidden="true" />
                  </button>
                ))}
        </div>
        {error && <div className="remote-directory-error" role="alert">{error}</div>}
        <div className="remote-directory-current"><Folder size={15} aria-hidden="true" /><span title={directory}>{directory}</span></div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" disabled={creating} onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={creating || loading || Boolean(loadError)} onClick={() => onChoose(directory)}><Check size={15} />解压到此目录</button>
        </div>
      </section>
    </div>
  ), document.body)
}

export interface RemoteArchiveDialogsProps {
  destination: ArchiveDestinationDialogState | null
  onCloseDestination: () => void
  onChooseDestination: (directory: string) => void
  onCreateDirectory: (directory: string, name: string) => Promise<void>
}

export function RemoteArchiveDialogs({ destination, onCloseDestination, onChooseDestination, onCreateDirectory }: RemoteArchiveDialogsProps) {
  return destination
    ? <RemoteDirectoryPicker state={destination} onClose={onCloseDestination} onChoose={onChooseDestination} onCreateDirectory={onCreateDirectory} />
    : null
}
