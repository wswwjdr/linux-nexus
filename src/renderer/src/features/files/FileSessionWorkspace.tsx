import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { FileTypeExtensions, RemoteEntry } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import LogPreviewDialog from '@/components/previews/LogPreviewDialog'
import PreviewDialog from '@/components/previews/PreviewDialog'
import type { PreviewSearchHandle } from '@/components/previews/usePreviewSearch'
import SearchDialog from '@/features/search/SearchDialog'
import { usePreview } from '@/hooks/usePreview'
import type { ScriptExecutionDialogState, SessionTab } from '@/app-types'
import type { FileContextMenuContext, FileMenuAction } from './file-menu'
import type { ToastNotice } from '@/GlobalToast'
import ScriptSessionDialogs from './ScriptSessionDialogs'

export interface SessionFileWorkspaceActions {
  requestSearch: (preferTextSearch?: boolean) => void
  previewFile: (entry: Pick<RemoteEntry, 'name' | 'path'>, type: PreviewType) => Promise<void>
  previewLogFile: (entry: Pick<RemoteEntry, 'name' | 'path'>) => Promise<void>
}

interface FileSessionWorkspaceProps {
  session: SessionTab
  active: boolean
  searchOpen: boolean
  propertiesOpen: boolean
  scriptCommandDialog: { name: string; command: string } | null
  scriptExecutionDialog: ScriptExecutionDialogState | null
  fileTypeExtensions: FileTypeExtensions
  showToast: (kind: ToastNotice['kind'], message: string) => void
  onSearchOpenChange: (sessionId: string, open: boolean) => void
  onWorkspaceOpenChange: (sessionId: string, open: boolean) => void
  onBlockingChange: (sessionId: string, blocking: boolean) => void
  onRegisterWorkspaceActions: (sessionId: string, actions: SessionFileWorkspaceActions | null) => void
  onCloseScriptCommand: (sessionId: string) => void
  onUpdateScriptCommand: (sessionId: string, command: string) => void
  onSubmitScriptCommand: (sessionId: string, event: FormEvent<HTMLFormElement>) => void
  onCloseScriptExecution: (sessionId: string) => void
  onStopScriptExecution: (sessionId: string) => void
  onMenuAction: (action: FileMenuAction, context: FileContextMenuContext, sessionId: string) => void
  onOpenExternalLink: (url: string) => void
}

export default function FileSessionWorkspace({
  session,
  active,
  searchOpen,
  propertiesOpen,
  scriptCommandDialog,
  scriptExecutionDialog,
  fileTypeExtensions,
  showToast,
  onSearchOpenChange,
  onWorkspaceOpenChange,
  onBlockingChange,
  onRegisterWorkspaceActions,
  onCloseScriptCommand,
  onUpdateScriptCommand,
  onSubmitScriptCommand,
  onCloseScriptExecution,
  onStopScriptExecution,
  onMenuAction,
  onOpenExternalLink,
}: FileSessionWorkspaceProps) {
  const preview = usePreview({
    sessionId: session.status === 'connected' ? session.id : null,
    fileTypeExtensions,
    showToast,
  })

  const [confirmDiscardForSearch, setConfirmDiscardForSearch] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const textSearchRef = useRef<PreviewSearchHandle>(null)
  const previewOpen = Boolean(preview.previewDialog || preview.logPreviewDialog)
  const openSearch = useCallback(() => {
    preview.closePreview()
    onSearchOpenChange(session.id, true)
    if (searchOpen && !previewOpen) {
      (workspaceRef.current?.querySelector<HTMLInputElement>('.search-tab-panel:not([hidden]) .search-query-field input:not(:disabled)') ?? workspaceRef.current?.querySelector<HTMLButtonElement>('.search-modal .modal-close'))?.focus()
    }
  }, [onSearchOpenChange, preview.closePreview, previewOpen, searchOpen, session.id])
  const requestSearch = useCallback((preferTextSearch = false) => {
    if (!active || preview.textSaving || preview.textSaveConfirmation || confirmDiscardForSearch) return
    if (preferTextSearch && textSearchRef.current) {
      textSearchRef.current.openSearch()
      return
    }
    if (preview.textDirty) setConfirmDiscardForSearch(true)
    else openSearch()
  }, [active, confirmDiscardForSearch, openSearch, preview.textDirty, preview.textSaveConfirmation, preview.textSaving])
  useEffect(() => {
    if (active && searchOpen && !previewOpen && !propertiesOpen && !confirmDiscardForSearch) {
      const timer = window.setTimeout(() => (workspaceRef.current?.querySelector<HTMLInputElement>('.search-tab-panel:not([hidden]) .search-query-field input:not(:disabled)') ?? workspaceRef.current?.querySelector<HTMLButtonElement>('.search-modal .modal-close'))?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
  }, [active, searchOpen, previewOpen, propertiesOpen, confirmDiscardForSearch])
  useEffect(() => {
    onRegisterWorkspaceActions(session.id, {
      previewFile: preview.previewFile,
      previewLogFile: preview.previewLogFile,
      requestSearch,
    })
    return () => onRegisterWorkspaceActions(session.id, null)
  }, [onRegisterWorkspaceActions, preview.previewFile, preview.previewLogFile, requestSearch, session.id])

  useEffect(() => {
    if (session.status !== 'disconnected') return
    preview.closePreview()
    setConfirmDiscardForSearch(false)
    onSearchOpenChange(session.id, false)
  }, [session.id, session.status])

  useEffect(() => {
    onBlockingChange(session.id, active && Boolean(preview.textSaveConfirmation || confirmDiscardForSearch))
    return () => onBlockingChange(session.id, false)
  }, [active, confirmDiscardForSearch, onBlockingChange, preview.textSaveConfirmation, session.id])

  useEffect(() => {
    onWorkspaceOpenChange(session.id, active && (
      searchOpen
      || Boolean(preview.previewDialog || preview.logPreviewDialog)
      || Boolean(scriptCommandDialog || scriptExecutionDialog)
    ))
    return () => onWorkspaceOpenChange(session.id, false)
  }, [
    active,
    onWorkspaceOpenChange,
    preview.logPreviewDialog,
    preview.previewDialog,
    scriptCommandDialog,
    scriptExecutionDialog,
    searchOpen,
    session.id,
  ])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (!active || event.key !== 'Escape' || preview.textSaveConfirmation || confirmDiscardForSearch) return
      if (!preview.previewDialog && !preview.logPreviewDialog) return
      event.preventDefault()
      if (textSearchRef.current?.closeSearch()) return
      preview.closePreview()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [active, confirmDiscardForSearch, preview.closePreview, preview.logPreviewDialog, preview.previewDialog, preview.textSaveConfirmation])

  return (
    <div ref={workspaceRef} className={'session-workspace-layer' + (active ? ' active' : '')} aria-hidden={!active}>
      {searchOpen && (
        <SearchDialog
          sessionId={session.id}
          profileId={session.profileId}
          currentPath={session.currentPath}
          visible={active && !previewOpen}
          fileTypeExtensions={fileTypeExtensions}
          previewOpen={previewOpen || propertiesOpen}
          onClose={() => onSearchOpenChange(session.id, false)}
          onMenuAction={(action, context) => onMenuAction(action, context, session.id)}
        />
      )}

      <PreviewDialog
        previewDialog={preview.previewDialog}
        textDraft={preview.textDraft}
        textDirty={preview.textDirty}
        textSaving={preview.textSaving}
        textSaveConfirmation={preview.textSaveConfirmation}
        textSearchRef={textSearchRef}
        imageZoom={preview.imageZoom}
        imagePreviewSize={preview.imagePreviewSize}
        imageViewportRef={preview.imageViewportRef}
        previewImageRef={preview.previewImageRef}
        onClosePreview={preview.closePreview}
        onOpenExternalLink={onOpenExternalLink}
        onUpdateTextDraft={preview.updateTextDraft}
        onRequestTextSave={preview.requestTextSave}
        onPreviewImageLoad={preview.onImageLoad}
        onZoomPreviewImage={preview.zoomImage}
      />

      <LogPreviewDialog
        logPreviewDialog={preview.logPreviewDialog}
        logViewportRef={preview.logViewportRef}
        textSearchRef={textSearchRef}
        onClosePreview={preview.closePreview}
        onLogPreviewScroll={preview.onLogPreviewScroll}
      />

      <ScriptSessionDialogs
        sessionId={session.id}
        active={active}
        commandDialog={scriptCommandDialog}
        executionDialog={scriptExecutionDialog}
        onCloseCommand={() => onCloseScriptCommand(session.id)}
        onUpdateCommand={(command) => onUpdateScriptCommand(session.id, command)}
        onSubmitCommand={(event) => onSubmitScriptCommand(session.id, event)}
        onCloseExecution={() => onCloseScriptExecution(session.id)}
        onStopExecution={() => onStopScriptExecution(session.id)}
      />

      {active && confirmDiscardForSearch && (
        <ConfirmationDialog
          title="放弃未保存的修改？"
          description="关闭预览将丢弃尚未保存的修改。"
          tone="warning"
          confirmLabel="放弃修改并搜索"
          cancelLabel="继续编辑"
          onConfirm={() => { setConfirmDiscardForSearch(false); openSearch() }}
          onCancel={() => {
            setConfirmDiscardForSearch(false)
            workspaceRef.current?.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.focus()
          }}
        />
      )}

      {active && preview.textSaveConfirmation && (
        <ConfirmationDialog
          eyebrow="保存远程文件"
          title={`保存对 ${preview.textSaveConfirmation.name} 的修改？`}
          details={[{ label: '远程路径', value: preview.textSaveConfirmation.path }]}
          description="保存将用当前编辑的内容替换服务器上的文件。"
          tone="warning"
          confirmLabel="保存修改"
          busyLabel="正在保存"
          error={preview.textSaveError}
          errorLabel="保存失败"
          busy={preview.textSaving}
          onConfirm={() => void preview.confirmTextSave()}
          onCancel={preview.cancelTextSave}
        />
      )}
    </div>
  )
}
