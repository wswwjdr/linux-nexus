import { type MessageValue, formatLocale, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Info, LoaderCircle, X } from 'lucide-react'
import type { RemoteEntryProperties } from '@shared/types'
import { errorMessage, formatDate, formatSize } from '../app-utils'

interface PropertiesDialogProps {
  sessionId: string
  path: string
  returnFocus?: HTMLElement | null
  onClose: () => void
}

type PropertiesState = { kind: 'loading' } | { kind: 'ready'; value: RemoteEntryProperties } | { kind: 'error'; message: MessageValue }
type DiskUsageState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; bytes: number } | { kind: 'error'; message: MessageValue }
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
  const [diskUsage, setDiskUsage] = useState<DiskUsageState>({ kind: 'idle' })
  const mountedRef = useRef(false)
  const calculatingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    mountedRef.current = true
    dialogRef.current!.querySelector<HTMLButtonElement>('button')!.focus()
    return () => {
      mountedRef.current = false
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    }
  }, [returnFocus])

  useEffect(() => {
    let active = true
    setProperties({ kind: 'loading' })
    void window.remoteFiles.getRemoteEntryProperties(sessionId, path).then(
      (value) => { if (active) setProperties({ kind: 'ready', value }) },
      (error: unknown) => { if (active) setProperties({ kind: 'error', message: errorMessage(error) }) },
    )
    return () => { active = false }
  }, [sessionId, path, attempt])

  useEffect(() => {
    const dismiss = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', dismiss, true)
    return () => window.removeEventListener('keydown', dismiss, true)
  }, [onClose])

  const calculateDiskUsage = async () => {
    if (calculatingRef.current) return
    calculatingRef.current = true
    setDiskUsage({ kind: 'loading' })
    try {
      const bytes = await window.remoteFiles.getRemoteDirectoryDiskUsage(sessionId, path)
      if (mountedRef.current) setDiskUsage({ kind: 'ready', bytes })
    } catch (error) {
      if (mountedRef.current) setDiskUsage({ kind: 'error', message: errorMessage(error) })
    } finally {
      calculatingRef.current = false
    }
  }

  const trapFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const buttons = Array.from(dialogRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
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
    <div className="modal-backdrop file-properties-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="modal file-properties-modal" role="dialog" aria-modal="true" aria-labelledby="file-properties-title" onKeyDown={trapFocus}>
        <div className="modal-heading">
          <h2 id="file-properties-title"><Info size={18} />{tr('files.properties')}</h2>
          <button type="button" className="icon-button modal-close" title={tr('common.close')} aria-label={tr('common.close')} onClick={onClose}><X size={18} /></button>
        </div>
        <div className="file-properties-content">
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
                <div className="file-properties-disk-usage" aria-live="polite">
                  <span>{diskUsage.kind === 'ready' ? byteLabel(diskUsage.bytes) : diskUsage.kind === 'loading' ? tr('files.calculating') : diskUsage.kind === 'error' ? tr('files.calculationFailed') : tr('files.notCalculated')}</span>
                  {diskUsage.kind !== 'ready' && <button type="button" className="secondary-button" disabled={diskUsage.kind === 'loading'} onClick={() => void calculateDiskUsage()}>
                    {diskUsage.kind === 'loading' && <LoaderCircle size={14} className="spin" />}
                    {diskUsage.kind === 'error' ? tr('files.retryCalculation') : tr('files.calculateDiskUsage')}
                  </button>}
                </div>
                <p className="file-properties-hint">{tr('files.calculatesDiskUsageRecursivelyWithoutFollowingSymbolicLinksLargeDirectories')}</p>
                {diskUsage.kind === 'error' && <div className="confirmation-error" role="alert">{tr('files.couldNotCalculateDiskUsage')}{renderMessage(diskUsage.message)}</div>}
              </dd>
            </div>}
          </dl>}
        </div>
        <div className="modal-footer"><button type="button" className="primary-button" onClick={onClose}>{tr('common.close')}</button></div>
      </section>
    </div>
  )
}
