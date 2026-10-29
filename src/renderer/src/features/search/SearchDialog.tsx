import { useCallback, useEffect, useRef, useState } from 'react'
import { FileSearch, FileText, X } from 'lucide-react'
import type { FileTypeExtensions } from '@shared/types'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import { ContentSearchPane } from '@/features/search/ContentSearchPane'
import { NameSearchPane } from '@/features/search/NameSearchPane'
import type { SearchPaneHandle } from '@/features/search/SearchPaneShared'
import type { FileContextMenuContext, FileMenuAction } from '@/features/files/file-menu'

interface SearchDialogProps {
  sessionId: string
  profileId: string
  currentPath: string
  visible: boolean
  previewOpen: boolean
  fileTypeExtensions: FileTypeExtensions
  onClose: () => void
  onMenuAction: (action: FileMenuAction, context: FileContextMenuContext) => void
}

type SearchTab = 'name' | 'content'

export default function SearchDialog({ sessionId, profileId, currentPath, visible, previewOpen, fileTypeExtensions, onClose, onMenuAction }: SearchDialogProps) {
  const [activeTab, setActiveTab] = useState<SearchTab>('name')
  const [running, setRunning] = useState({ name: false, content: false })
  const [menuOpen, setMenuOpen] = useState({ name: false, content: false })
  const [confirmClose, setConfirmClose] = useState(false)
  const namePaneRef = useRef<SearchPaneHandle>(null)
  const contentPaneRef = useRef<SearchPaneHandle>(null)
  const stateRef = useRef({ running, menuOpen, confirmClose, previewOpen })
  stateRef.current = { running, menuOpen, confirmClose, previewOpen }
  const anyRunning = running.name || running.content

  const updateNameRunning = useCallback((value: boolean) => {
    setRunning((current) => current.name === value ? current : { ...current, name: value })
  }, [])
  const updateContentRunning = useCallback((value: boolean) => {
    setRunning((current) => current.content === value ? current : { ...current, content: value })
  }, [])
  const updateNameMenu = useCallback((value: boolean) => {
    setMenuOpen((current) => current.name === value ? current : { ...current, name: value })
  }, [])
  const updateContentMenu = useCallback((value: boolean) => {
    setMenuOpen((current) => current.content === value ? current : { ...current, content: value })
  }, [])

  const requestClose = useCallback(() => {
    if (stateRef.current.running.name || stateRef.current.running.content) setConfirmClose(true)
    else onClose()
  }, [onClose])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || stateRef.current.previewOpen) return
      if (stateRef.current.menuOpen.name || stateRef.current.menuOpen.content) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (stateRef.current.confirmClose) setConfirmClose(false)
      else requestClose()
    }
    window.addEventListener('keydown', dismissOnEscape, true)
    return () => window.removeEventListener('keydown', dismissOnEscape, true)
  }, [requestClose])

  const confirmPendingAction = () => {
    setConfirmClose(false)
    if (anyRunning) {
      namePaneRef.current?.cancel()
      contentPaneRef.current?.cancel()
    }
    onClose()
  }

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) requestClose()
    }}>
      <section className="modal search-modal" role="dialog" aria-labelledby="search-dialog-title">
        <header className="search-dialog-header">
          <div className="search-dialog-heading">
            <h2 id="search-dialog-title">搜索文件</h2>
            <div className="search-tabs" role="tablist" aria-label="搜索类型">
              <button
                id="name-search-tab"
                type="button"
                role="tab"
                aria-selected={activeTab === 'name'}
                aria-controls="name-search-panel"
                className="search-tab"
                onClick={() => setActiveTab('name')}
              ><FileSearch size={14} /> 文件名</button>
              <button
                id="content-search-tab"
                type="button"
                role="tab"
                aria-selected={activeTab === 'content'}
                aria-controls="content-search-panel"
                className="search-tab"
                onClick={() => setActiveTab('content')}
              ><FileText size={14} /> 文本内容</button>
            </div>
          </div>
          <button className="icon-button modal-close" title="关闭搜索" aria-label="关闭搜索" onClick={requestClose}>
            <X size={17} />
          </button>
        </header>

        <div id="name-search-panel" className="search-tab-panel" role="tabpanel" aria-labelledby="name-search-tab" hidden={activeTab !== 'name'}>
          <NameSearchPane
            ref={namePaneRef}
            sessionId={sessionId}
            profileId={profileId}
            currentPath={currentPath}
            active={visible && activeTab === 'name'}
            fileTypeExtensions={fileTypeExtensions}
            onRunningChange={updateNameRunning}
            onMenuOpenChange={updateNameMenu}
            onMenuAction={onMenuAction}
          />
        </div>
        <div id="content-search-panel" className="search-tab-panel" role="tabpanel" aria-labelledby="content-search-tab" hidden={activeTab !== 'content'}>
          <ContentSearchPane
            ref={contentPaneRef}
            sessionId={sessionId}
            profileId={profileId}
            currentPath={currentPath}
            active={visible && activeTab === 'content'}
            fileTypeExtensions={fileTypeExtensions}
            onRunningChange={updateContentRunning}
            onMenuOpenChange={updateContentMenu}
            onMenuAction={onMenuAction}
          />
        </div>
      </section>
      {confirmClose && (
        <ConfirmationDialog
          title={anyRunning ? '搜索仍在进行' : '关闭搜索窗口？'}
          description={anyRunning ? '取消正在运行的搜索并关闭窗口吗？' : '关闭搜索窗口吗？'}
          tone="warning"
          confirmLabel={anyRunning ? '取消搜索并关闭' : '关闭搜索'}
          cancelLabel={anyRunning ? '继续搜索' : '返回搜索'}
          onConfirm={confirmPendingAction}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </div>
  )
}
