import { useEffect, useId, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, ChevronRight, File, Folder, FolderPlus, LoaderCircle, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RemoteArchiveConflict, RemoteArchiveDecision, RemoteArchiveResult, RemoteEntry } from '@shared/types'
import type { ActiveArchiveExtraction, ArchiveDestinationDialogState } from '../features/remote-files/useRemoteOperations'
import { RemoteConflictDialog, type RemoteConflictDialogAction, type RemoteConflictDialogChoice } from './RemoteConflictDialog'

function archiveItemType(type: 'file' | 'directory' | 'symlink' | 'other'): string {
  if (type === 'directory') return '文件夹'
  if (type === 'file') return '文件'
  if (type === 'symlink') return '符号链接'
  return '特殊文件'
}

function ArchiveConflictDialog({
  conflict,
  busy,
  onDecision,
}: {
  conflict: RemoteArchiveConflict
  busy: boolean
  onDecision: (decision: RemoteArchiveDecision) => void
}) {
  const mismatch = conflict.conflictType === 'type-mismatch'
  const actions: RemoteConflictDialogAction[] = mismatch
    ? [
        { decision: 'replace', label: '删除目标并替换', tone: 'danger' },
        { decision: 'rename', label: '保留双方并重命名' },
        { decision: 'skip', label: '跳过此项' },
        { decision: 'cancel', label: '取消解压' },
      ]
    : []
  const choices: RemoteConflictDialogChoice[] = mismatch ? [] : [
    { decision: 'skip', label: '跳过此文件' },
    { decision: 'replace', label: '覆盖此文件' },
    { decision: 'rename', label: '自动重命名' },
  ]
  const batchDecisions: Record<RemoteConflictDialogChoice['decision'], RemoteArchiveDecision> = {
    replace: 'replace-all',
    skip: 'skip-all',
    rename: 'rename-all',
  }
  return <RemoteConflictDialog
    heading="远程解压冲突"
    title={mismatch ? '同名项目类型不同' : '目标文件已存在'}
    sourceLabel="归档条目"
    sourcePath={`${conflict.archivePath} 内的 ${conflict.memberPath}`}
    targetPath={conflict.targetPath}
    sourceType={conflict.sourceType}
    targetType={conflict.targetType}
    description={mismatch
      ? `归档中的${archiveItemType(conflict.sourceType)}与目标${archiveItemType(conflict.targetType)}类型不同。覆盖会先删除整个目标及其内容，此操作无法撤销。`
      : '选择如何处理此文件。“应用到全部文件”会将所选动作应用于当前及本次解压后续的普通文件冲突；类型不匹配仍单独确认。'}
    actions={actions}
    choices={mismatch ? undefined : choices}
    defaultChoice="replace"
    applyToAllLabel={mismatch ? undefined : '应用到全部文件'}
    onConfirmChoice={mismatch ? undefined : (decision, applyToAll) => {
      if (!applyToAll) {
        onDecision(decision)
        return
      }
      onDecision(batchDecisions[decision])
    }}
    busy={busy}
    onDecision={(decision) => onDecision(decision as RemoteArchiveDecision)}
  />
}

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
      if (active) setLoadError(reason instanceof Error ? reason.message : String(reason))
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
      setError('请输入有效的文件夹名称')
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
      setError(reason instanceof Error ? reason.message : String(reason))
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
          <input
            aria-label="新文件夹名称"
            autoComplete="off"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="新建文件夹"
            disabled={creating}
          />
          <button type="submit" className="secondary-button" disabled={creating || !newFolderName.trim()}>
            {creating ? <LoaderCircle className="spin" size={15} /> : <FolderPlus size={15} />}
            新建
          </button>
        </form>
        <div className="remote-directory-list" aria-label="文件夹列表" aria-busy={loading}>
          {loading ? <div className="remote-directory-empty"><LoaderCircle className="spin" size={17} />正在读取目录…</div>
            : loadError ? <div className="remote-directory-error" role="alert">{loadError}</div>
              : entries.length === 0 ? <div className="remote-directory-empty">此目录没有子文件夹</div>
                : entries.map((entry) => (
                  <button className="remote-directory-entry" type="button" key={entry.path} onClick={() => navigateDirectory(entry.path)}>
                    <Folder size={16} aria-hidden="true" />
                    <span>{entry.name}</span>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                ))}
        </div>
        {error && <div className="remote-directory-error" role="alert">{error}</div>}
        <div className="remote-directory-current"><Folder size={15} aria-hidden="true" /><span title={directory}>{directory}</span></div>
        <div className="modal-footer">
          <button type="button" className="secondary-button" disabled={creating} onClick={onClose}>取消</button>
          <button type="button" className="primary-button" disabled={creating || loading || Boolean(loadError)} onClick={() => onChoose(directory)}>
            <Check size={15} />选择此目录
          </button>
        </div>
      </section>
    </div>
  ), document.body)
}

function RemoteArchiveSummary({ result, onClose }: { result: RemoteArchiveResult; onClose: () => void }) {
  const titleId = useId()
  const hasFailures = result.failedCount > 0 || result.cancelledCount > 0
  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [onClose])
  return createPortal((
    <div className="modal-backdrop confirmation-backdrop remote-archive-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal remote-archive-summary" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className={'confirmation-icon ' + (hasFailures ? 'warning' : 'success')}>
            {hasFailures ? <AlertTriangle size={19} /> : <Check size={19} />}
          </div>
          <div className="confirmation-title-group">
            <div className="modal-kicker">远程解压</div>
            <h2 id={titleId}>{result.status === 'cancelled' ? '解压已取消' : hasFailures ? '解压完成，部分项目失败' : '解压完成'}</h2>
          </div>
          <button className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="remote-archive-output" title={result.outputDirectory}>{result.outputDirectory}</p>
        <div className="remote-move-summary-counts" aria-label="解压结果">
          <span><strong>{result.extractedCount}</strong> 已处理</span>
          <span><strong>{result.skippedCount}</strong> 已跳过</span>
          <span><strong>{result.failedCount}</strong> 失败</span>
          {result.cancelledCount > 0 && <span><strong>{result.cancelledCount}</strong> 未处理</span>}
        </div>
        {result.results.length > 0 && (
          <div className="remote-move-result-list" role="list" aria-label="解压项目详情">
            {result.results.map((item, index) => (
              <div className="remote-move-result-item" role="listitem" key={`${item.path}-${index}`}>
                <strong><File size={13} />{item.status === 'failed' ? '失败' : '已跳过'}：{item.path}</strong>
                {item.message && <span>{item.message}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="modal-footer"><button type="button" className="primary-button" onClick={onClose}>完成</button></div>
      </section>
    </div>
  ), document.body)
}

export interface RemoteArchiveDialogsProps {
  destination: ArchiveDestinationDialogState | null
  extraction: ActiveArchiveExtraction | null
  summary: RemoteArchiveResult | null
  onCloseDestination: () => void
  onChooseDestination: (directory: string) => void
  onCreateDirectory: (directory: string, name: string) => Promise<void>
  onConflictDecision: (decision: RemoteArchiveDecision) => void
  onCloseSummary: () => void
}

export function RemoteArchiveDialogs({
  destination,
  extraction,
  summary,
  onCloseDestination,
  onChooseDestination,
  onCreateDirectory,
  onConflictDecision,
  onCloseSummary,
}: RemoteArchiveDialogsProps) {
  return <>
    {destination && <RemoteDirectoryPicker state={destination} onClose={onCloseDestination} onChoose={onChooseDestination} onCreateDirectory={onCreateDirectory} />}
    {extraction?.conflict && <ArchiveConflictDialog key={extraction.conflict.conflictId} conflict={extraction.conflict} busy={extraction.decisionPending} onDecision={onConflictDecision} />}
    {summary && <RemoteArchiveSummary result={summary} onClose={onCloseSummary} />}
  </>
}
