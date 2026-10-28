import { useId, useState, type FormEvent } from 'react'
import { AlertTriangle, LoaderCircle, PackageCheck, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ArchiveDependency } from '@shared/types'

const dependencyLabels: Record<ArchiveDependency, string> = {
  unzip: 'unzip',
  gzip: 'gzip',
  bzip2: 'bzip2',
  xz: 'xz',
  zstd: 'zstd',
}

export default function ArchiveDependencyInstallDialog({
  dependencies,
  busy,
  error,
  onInstall,
  onCancel,
}: {
  dependencies: ArchiveDependency[]
  busy: boolean
  error: string | null
  onInstall: (password: string) => void
  onCancel: () => void
}) {
  const titleId = useId()
  const [password, setPassword] = useState('')

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onInstall(password)
    setPassword('')
  }

  return createPortal((
    <div className="modal-backdrop confirmation-backdrop" role="presentation">
      <section className="modal archive-dependency-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="confirmation-heading">
          <div className="confirmation-icon warning"><PackageCheck size={19} /></div>
          <div className="confirmation-title-group">
            <div className="modal-kicker warning">服务器归档工具</div>
            <h2 id={titleId}>安装缺少的依赖？</h2>
          </div>
          <button className="icon-button modal-close" title="取消" aria-label="取消" disabled={busy} onClick={onCancel}><X size={18} /></button>
        </div>
        <p className="confirmation-description">服务器缺少：{dependencies.map((dependency) => dependencyLabels[dependency]).join('、')}。确认后将使用 apt、dnf 或 yum 安装。</p>
        <form onSubmit={submit}>
          <label className="field">
            <span>sudo 密码</span>
            <input type="password" autoComplete="current-password" autoFocus required disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="confirmation-error" role="alert"><AlertTriangle size={14} />{error}</div>}
          <div className="modal-footer">
            <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button>
            <button type="submit" className="warning-button" disabled={busy || !password}>
              {busy ? <LoaderCircle className="spin" size={15} /> : <PackageCheck size={15} />}
              {busy ? '正在安装' : '安装依赖'}
            </button>
          </div>
        </form>
      </section>
    </div>
  ), document.body)
}
