import { type MessageValue, formatLocale, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { HardDrive, Info, LoaderCircle, X } from 'lucide-react'
import type { RemoteDirectoryStats, RemoteDirectoryUsageNode, RemoteEntryProperties } from '@shared/types'
import { errorMessage, formatDate, formatSize } from '../app-utils'
import DirectoryUsageTree from './DirectoryUsageTree'
import { useFileDependencyAction } from '@/features/dependencies/DependencyProvider'

interface PropertiesDialogProps {
  sessionId: string
  path: string
  returnFocus?: HTMLElement | null
  onClose: () => void
}

type PropertiesState = { kind: 'loading' } | { kind: 'ready'; value: RemoteEntryProperties } | { kind: 'error'; message: MessageValue }
type DirectoryStatsState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; value: RemoteDirectoryStats } | { kind: 'error'; message: MessageValue }
type DirectoryTreeState = { kind: 'loading' } | { kind: 'ready'; nodes: RemoteDirectoryUsageNode[] } | { kind: 'error'; message: MessageValue }
const typeLabels = { file: msg('files.file'), directory: msg('files.folder'), symlink: msg('files.symbolicLink'), other: msg('files.otherType') }
const byteLabel = (bytes: number) => tr('files.bytes', { "value1": formatSize(bytes), "value2": bytes.toLocaleString(formatLocale()) })

export default function RemoteEntryPropertiesDialog(props: PropertiesDialogProps) {
  useLanguage()
  return <PropertiesDialogContent key={JSON.stringify([props.sessionId, props.path])} {...props} />
}

function PropertiesDialogContent({ sessionId, path, returnFocus, onClose }: PropertiesDialogProps) {
  useLanguage()
  const [properties, setProperties] = useState<PropertiesState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [directoryStats, setDirectoryStats] = useState<DirectoryStatsState>({ kind: 'idle' })
  const [directoryTree, setDirectoryTree] = useState<DirectoryTreeState | null>(null)
  const mountedRef = useRef(false)
  const withDependencies = useFileDependencyAction()
  const statsWait = useRef<AbortController | null>(null)
  const calculatingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const treeRequest = useRef<string | null>(null)
  const detailedButton = useRef<HTMLButtonElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const showingTree = directoryTree !== null

  const cancelTree = useCallback(() => {
    const requestId = treeRequest.current
    if (requestId === null) return
    treeRequest.current = null
    void window.remoteFiles.cancelRemoteDirectoryUsageTree(requestId).catch(error => console.error(error))
  }, [])
  const close = useCallback(() => { cancelTree(); onClose() }, [cancelTree, onClose])
  useEffect(() => cancelTree, [cancelTree])

  useLayoutEffect(() => {
    if (showingTree) backButton.current!.focus()
    else detailedButton.current?.focus()
  }, [showingTree])

  useEffect(() => {
    mountedRef.current = true
    dialogRef.current!.querySelector<HTMLButtonElement>('button')!.focus()
    return () => {
      mountedRef.current = false
      statsWait.current?.abort()
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [returnFocus])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setProperties({ kind: 'loading' })
    void withDependencies(() => window.remoteFiles.getRemoteEntryProperties(sessionId, path), sessionId, path, controller.signal).then(
      (value) => { if (active) setProperties({ kind: 'ready', value }) },
      (error: unknown) => { if (active) setProperties({ kind: 'error', message: errorMessage(error) }) },
    )
    return () => { active = false; controller.abort(); statsWait.current?.abort() }
  }, [sessionId, path, attempt, withDependencies])

  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [close])

  const calculateTree = async () => {
    if (treeRequest.current !== null) return
    const requestId = crypto.randomUUID()
    treeRequest.current = requestId
    setDirectoryTree({ kind: 'loading' })
    backButton.current?.focus()
    try {
      const nodes = await window.remoteFiles.getRemoteDirectoryUsageTree(sessionId, path, requestId)
      if (treeRequest.current === requestId) setDirectoryTree({ kind: 'ready', nodes })
    } catch (error) {
      if (treeRequest.current === requestId) setDirectoryTree({ kind: 'error', message: errorMessage(error) })
    } finally {
      if (treeRequest.current === requestId) treeRequest.current = null
    }
  }

  const backToProperties = () => {
    cancelTree()
    setDirectoryTree(null)
  }

  /** Checks directory statistics dependencies before calculating the displayed totals. */
  const calculateDirectoryStats = async () => {
    if (calculatingRef.current) return
    calculatingRef.current = true
    const controller = new AbortController()
    statsWait.current = controller
    setDirectoryStats({ kind: 'loading' })
    try {
      const value = await withDependencies(() => window.remoteFiles.getRemoteDirectoryStats(sessionId, path), sessionId, path, controller.signal)
      if (mountedRef.current && !controller.signal.aborted) setDirectoryStats({ kind: 'ready', value })
    } catch (error) {
      if (mountedRef.current && !controller.signal.aborted) setDirectoryStats({ kind: 'error', message: errorMessage(error) })
    } finally {
      if (statsWait.current === controller) {
        statsWait.current = null
        calculatingRef.current = false
      }
    }
  }

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialogRef.current!.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const value = properties.kind === 'ready' ? properties.value : null
  const details = value ? [
    [tr('common.name'), value.name], [tr('files.fullPath'), value.path], [tr('files.type'), typeLabels[value.type]],
    ...(value.type === 'directory' ? [] : [[tr('files.size'), byteLabel(value.size)]]),
    [tr('files.permissions'), `${value.permissions}（${value.symbolicPermissions}）`],
    [tr('files.owner'), `${value.owner}（UID: ${value.uid}）`], [tr('files.group'), `${value.group}（GID: ${value.gid}）`],
    [tr('files.accessed'), formatDate(value.accessedAt)], [tr('files.modified'), formatDate(value.modifiedAt)],
    [tr('files.metadataChanged'), formatDate(value.changedAt)],
    ...(value.createdAt === null ? [] : [[tr('files.created'), formatDate(value.createdAt)]]),
    ...(value.linkTarget === null ? [] : [[tr('files.linkTarget'), value.linkTarget]]),
  ] : []

  return (
    <div className="modal-backdrop file-properties-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section ref={dialogRef} className={showingTree ? 'modal file-properties-modal directory-usage-modal' : 'modal file-properties-modal'} role="dialog" aria-modal="true" aria-labelledby="file-properties-title" onKeyDown={trapFocus}>
        <div className="modal-heading">
          <h2 id="file-properties-title">{showingTree ? <><HardDrive size={18} />{tr('files.detailedDiskUsage')}</> : <><Info size={18} />{tr('files.properties')}</>}</h2>
          <button type="button" className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} onClick={close}><X size={18} /></button>
        </div>
        {directoryTree ? <>
          {directoryTree.kind === 'loading' && <p className="file-properties-status" role="status"><LoaderCircle size={16} className="spin" />{tr('files.scanningDirectoryUsage')}</p>}
          {directoryTree.kind === 'error' && <div className="file-properties-content">
            <div className="confirmation-error" role="alert">
              <strong>{tr('files.couldNotCalculateDetailedDiskUsage')}</strong>
              <div>{renderMessage(directoryTree.message)}</div>
            </div>
            <button type="button" className="secondary-button file-properties-calculate" onClick={() => void calculateTree()}>{tr('files.retryCalculation')}</button>
          </div>}
          {directoryTree.kind === 'ready' && <DirectoryUsageTree nodes={directoryTree.nodes} path={path} />}
        </> : <div className="file-properties-content">
          {properties.kind === 'loading' && <p className="file-properties-status" role="status"><LoaderCircle size={16} className="spin" />{tr('files.readingFileProperties')}</p>}
          {properties.kind === 'error' && <>
            <div className="confirmation-error" role="alert">{tr('files.couldNotReadProperties')}{renderMessage(properties.message)}</div>
            <button type="button" className="secondary-button" onClick={() => setAttempt((current) => current + 1)}>{tr('files.retryReading')}</button>
          </>}
          {value && <dl className="file-properties-details">
            {details.map(([label, text]) => <div key={renderMessage(label)}><dt>{renderMessage(label)}</dt><dd>{renderMessage(text)}</dd></div>)}
            {value.type === 'directory' && <div>
              <dt>{tr('files.diskUsage')}</dt>
              <dd>
                <div className="file-properties-disk-usage">
                  <div aria-live="polite" aria-atomic="true" className={directoryStats.kind === 'ready' ? 'file-properties-stats-result' : undefined}>
                    {directoryStats.kind === 'ready' ? <>
                      <div>{byteLabel(directoryStats.value.allocatedBytes)}</div>
                      <div className="file-properties-directory-contents">{tr('files.directoryContents', {
                        folders: msg('files.folderCount', { count: directoryStats.value.directoryCount }),
                        files: msg('files.fileCount', { count: directoryStats.value.fileCount }),
                      })}</div>
                    </> : directoryStats.kind === 'loading' ? tr('files.calculating') : directoryStats.kind === 'error' ? tr('files.calculationFailed') : tr('files.notCalculated')}
                  </div>
                  {directoryStats.kind !== 'ready' &&
                    <button type="button" className="secondary-button file-properties-calculate" disabled={directoryStats.kind === 'loading'} onClick={() => void calculateDirectoryStats()}>
                      {directoryStats.kind === 'loading' && <LoaderCircle size={14} className="spin" />}
                      {directoryStats.kind === 'error' ? tr('files.retryCalculation') : tr('files.calculateDiskUsage')}
                    </button>}
                  <button ref={detailedButton} type="button" className="secondary-button file-properties-calculate" onClick={() => void calculateTree()}>{tr('files.calculateDetailedDiskUsage')}</button>
                </div>
                {directoryStats.kind !== 'ready' && <p className="file-properties-hint">{tr('files.directoryStatsHint')}</p>}
                {directoryStats.kind === 'error' && <div className="confirmation-error" role="alert">{tr('files.couldNotCalculateDiskUsage')}{renderMessage(directoryStats.message)}</div>}
              </dd>
            </div>}
          </dl>}
        </div>}
        <div className="modal-footer">
          {directoryTree && <button ref={backButton} type="button" className="secondary-button" onClick={backToProperties}>
            {tr(directoryTree.kind === 'loading' ? 'common.cancel' : 'files.backToProperties')}
          </button>}
          <button type="button" className="primary-button" onClick={close}>{tr('common.close')}</button>
        </div>
      </section>
    </div>
  )
}
