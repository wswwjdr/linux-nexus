import { type MessageValue, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { Fragment, type ReactNode } from 'react'
import { Keyboard, X } from 'lucide-react'

export interface ShortcutGroup { title: MessageValue; items: { keys: MessageValue[]; description: MessageValue }[] }

export function MediaPreviewHeader({ title, titleId, icon, showShortcuts, shortcutsId, onToggleShortcuts, onClose }: {
  title: string; titleId: string; icon: ReactNode; showShortcuts: boolean; shortcutsId: string
  onToggleShortcuts: () => void; onClose: () => void
}) {
  useLanguage()
  return <><div className="ap-accent-bar" /><div className="ap-header">
    <div className="ap-title-area"><span className="ap-title-icon">{icon}</span><h2 id={titleId} title={title}>{title}</h2></div>
    <div className="ap-header-actions">
      <button className={'ap-icon-button' + (showShortcuts ? ' active' : '')} title={tr('previews.shortcuts')} aria-label={tr('previews.shortcuts')} aria-expanded={showShortcuts} aria-controls={shortcutsId} onClick={onToggleShortcuts}><Keyboard size={16} /></button>
      <button className="ap-icon-button ap-close" title={tr('previews.closePreview')} aria-label={tr('previews.closePreview')} onClick={onClose}><X size={18} strokeWidth={2.5} /></button>
    </div>
  </div></>
}

export function MediaShortcuts({ id, open, groups }: { id: string; open: boolean; groups: ShortcutGroup[] }) {
  useLanguage()
  return <div id={id} className={'ap-shortcuts-collapse' + (open ? ' open' : '')} inert={!open} aria-hidden={!open}>
    <div className="ap-shortcuts-panel"><div className="ap-shortcuts-groups">
      {groups.map((group) => <div className="ap-shortcuts-group" key={renderMessage(group.title)}>
        <div className="ap-group-title">{renderMessage(group.title)}</div>
        {group.items.map((item) => <div className="ap-shortcut-item" key={renderMessage(item.description)}>
          <span className="ap-shortcut-keys">{item.keys.map((key, index) => <Fragment key={renderMessage(key)}>{index > 0 && <span className="ap-key-separator"> / </span>}<kbd>{renderMessage(key)}</kbd></Fragment>)}</span>
          <span className="ap-shortcut-desc">{renderMessage(item.description)}</span>
        </div>)}
      </div>)}
    </div></div>
  </div>
}
