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

type PropertiesState = { kind: 'loading' } | { kind: 'ready'; value: RemoteEntryProperties } | { kind: 'error'; message: string }
type DiskUsageState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; bytes: number } | { kind: 'error'; message: string }
const typeLabels = { file: '文件', directory: '文件夹', symlink: '符号链接', other: '其他类型' }
const byteLabel = (bytes: number) => `${formatSize(bytes)}（${bytes.toLocaleString('zh-CN')} 字节）`

export default function RemoteEntryPropertiesDialog(props: PropertiesDialogProps) {
  return <PropertiesDialogContent key={JSON.stringify([props.sessionId, props.path])} {...props} />
}

function PropertiesDialogContent({ sessionId, path, returnFocus, onClose }: PropertiesDialogProps) {
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
    ['名称', value.name], ['完整路径', value.path], ['类型', typeLabels[value.type]],
    ...(value.type === 'directory' ? [] : [['大小', byteLabel(value.size)]]),
    ['权限', `${value.permissions}（${value.symbolicPermissions}）`],
    ['所有者', `${value.owner}（UID: ${value.uid}）`], ['所属组', `${value.group}（GID: ${value.gid}）`],
    ['访问时间', formatDate(value.accessedAt)], ['修改时间', formatDate(value.modifiedAt)],
    ['元数据变更时间', formatDate(value.changedAt)],
    ...(value.createdAt === null ? [] : [['创建时间', formatDate(value.createdAt)]]),
    ...(value.linkTarget === null ? [] : [['链接目标', value.linkTarget]]),
  ] : []

  return (
    <div className="modal-backdrop file-properties-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section ref={dialogRef} className="modal file-properties-modal" role="dialog" aria-modal="true" aria-labelledby="file-properties-title" onKeyDown={trapFocus}>
        <div className="modal-heading">
          <h2 id="file-properties-title"><Info size={18} /> 属性</h2>
          <button type="button" className="icon-button modal-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="file-properties-content">
          {properties.kind === 'loading' && <p className="file-properties-status" role="status"><LoaderCircle size={16} className="spin" /> 正在读取文件属性…</p>}
          {properties.kind === 'error' && <>
            <div className="confirmation-error" role="alert">读取属性失败：{properties.message}</div>
            <button type="button" className="secondary-button" onClick={() => setAttempt((current) => current + 1)}>重试读取</button>
          </>}
          {value && <dl className="file-properties-details">
            {details.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}
            {value.type === 'directory' && <div>
              <dt>占用空间</dt>
              <dd>
                <div className="file-properties-disk-usage" aria-live="polite">
                  <span>{diskUsage.kind === 'ready' ? byteLabel(diskUsage.bytes) : diskUsage.kind === 'loading' ? '正在计算…' : diskUsage.kind === 'error' ? '计算失败' : '未计算'}</span>
                  {diskUsage.kind !== 'ready' && <button type="button" className="secondary-button" disabled={diskUsage.kind === 'loading'} onClick={() => void calculateDiskUsage()}>
                    {diskUsage.kind === 'loading' && <LoaderCircle size={14} className="spin" />}
                    {diskUsage.kind === 'error' ? '重试计算' : '计算占用空间'}
                  </button>}
                </div>
                <p className="file-properties-hint">递归统计磁盘占用，不跟随符号链接；大目录可能需要较长时间。</p>
                {diskUsage.kind === 'error' && <div className="confirmation-error" role="alert">计算占用空间失败：{diskUsage.message}</div>}
              </dd>
            </div>}
          </dl>}
        </div>
        <div className="modal-footer"><button type="button" className="primary-button" onClick={onClose}>关闭</button></div>
      </section>
    </div>
  )
}
