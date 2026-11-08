import { type MessageValue, msg, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { FileTypeExtensions, RemoteEntry } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { previewTypesForFile } from '@shared/preview-file-type'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import LogPreviewDialog from '@/components/previews/LogPreviewDialog'
import PreviewDialog from '@/components/previews/PreviewDialog'
import TextSaveInstallDialog from '@/components/previews/TextSaveInstallDialog'
import type { PreviewSearchHandle } from '@/components/previews/usePreviewSearch'
import SearchDialog from '@/features/search/SearchDialog'
import { usePreview } from '@/hooks/usePreview'
import type { ScriptExecutionDialogState, SessionTab } from '@/app-types'
import type { FileContextMenuContext, FileMenuAction } from './file-menu'
import type { ToastNotice } from '@/GlobalToast'
import ScriptSessionDialogs from './ScriptSessionDialogs'
import FileOpenDialog from './FileOpenDialog'

export interface SessionFileWorkspaceActions {
  requestSearch: (preferTextSearch?: boolean) => void
  openFile: (entry: Pick<RemoteEntry, 'name' | 'path'>) => void
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
  showToast: (kind: ToastNotice['kind'], message: MessageValue) => void
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
  useLanguage()
  const preview = usePreview({
    sessionId: session.status === 'connected' ? session.id : null,
    fileTypeExtensions,
    showToast,
  })

  const [confirmDiscardForSearch, setConfirmDiscardForSearch] = useState(false)
  const [fileToOpen, setFileToOpen] = useState<Pick<RemoteEntry, 'name' | 'path'> | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const textSearchRef = useRef<PreviewSearchHandle>(null)
  const previewOpen = Boolean(preview.previewDialog || preview.logPreviewDialog)
  const openFile = useCallback((entry: Pick<RemoteEntry, 'name' | 'path'>) => {
    if (!active || session.status !== 'connected' || previewOpen || fileToOpen || confirmDiscardForSearch) return
    const types = previewTypesForFile(entry.name, fileTypeExtensions)
    if (types.length === 0) showToast('info', msg('connections.unsupportedFileType', { "name": entry.name }))
    else if (types.length === 1) void preview.previewFile(entry, types[0])
    else setFileToOpen({ name: entry.name, path: entry.path })
  }, [active, session.status, previewOpen, fileToOpen, confirmDiscardForSearch, fileTypeExtensions, showToast, preview.previewFile])
  const openSearch = useCallback(() => {
    preview.closePreview()
    onSearchOpenChange(session.id, true)
    if (searchOpen && !previewOpen) {
      (workspaceRef.current?.querySelector<HTMLInputElement>('.search-tab-panel:not([hidden]) .search-query-field input:not(:disabled)') ?? workspaceRef.current?.querySelector<HTMLButtonElement>('.search-modal .modal-close'))?.focus()
    }
  }, [onSearchOpenChange, preview.closePreview, previewOpen, searchOpen, session.id])
  const requestSearch = useCallback((preferTextSearch = false) => {
    if (!active || fileToOpen || preview.textSaving || preview.textSaveConfirmation || confirmDiscardForSearch) return
    if (preferTextSearch && textSearchRef.current) {
      textSearchRef.current.openSearch()
      return
    }
    if (preview.textDirty) setConfirmDiscardForSearch(true)
    else openSearch()
  }, [active, fileToOpen, confirmDiscardForSearch, openSearch, preview.textDirty, preview.textSaveConfirmation, preview.textSaving])
  useEffect(() => {
    if (active && searchOpen && !previewOpen && !propertiesOpen && !confirmDiscardForSearch && !fileToOpen) {
      const timer = window.setTimeout(() => (workspaceRef.current?.querySelector<HTMLInputElement>('.search-tab-panel:not([hidden]) .search-query-field input:not(:disabled)') ?? workspaceRef.current?.querySelector<HTMLButtonElement>('.search-modal .modal-close'))?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
  }, [active, searchOpen, previewOpen, propertiesOpen, confirmDiscardForSearch, fileToOpen])
  useEffect(() => {
    onRegisterWorkspaceActions(session.id, {
      previewFile: preview.previewFile,
      previewLogFile: preview.previewLogFile,
      requestSearch,
      openFile,
    })
    return () => onRegisterWorkspaceActions(session.id, null)
  }, [onRegisterWorkspaceActions, preview.previewFile, preview.previewLogFile, requestSearch, openFile, session.id])

  useEffect(() => {
    if (session.status !== 'disconnected') return
    preview.closePreview()
    setConfirmDiscardForSearch(false)
    setFileToOpen(null)
    onSearchOpenChange(session.id, false)
  }, [session.id, session.status])

  useEffect(() => {
    onBlockingChange(session.id, active && Boolean(preview.textSaveConfirmation || confirmDiscardForSearch || fileToOpen))
    return () => onBlockingChange(session.id, false)
  }, [active, confirmDiscardForSearch, fileToOpen, onBlockingChange, preview.textSaveConfirmation, session.id])

  useEffect(() => {
    onWorkspaceOpenChange(session.id, active && (
      searchOpen
      || Boolean(fileToOpen)
      || Boolean(preview.previewDialog || preview.logPreviewDialog)
      || Boolean(scriptCommandDialog || scriptExecutionDialog)
    ))
    return () => onWorkspaceOpenChange(session.id, false)
  }, [
    active,
    fileToOpen,
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
      if (event.defaultPrevented || !active || event.key !== 'Escape' || preview.textSaveConfirmation || confirmDiscardForSearch) return
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
          visible={active && !previewOpen && !fileToOpen}
          fileTypeExtensions={fileTypeExtensions}
          previewOpen={previewOpen || propertiesOpen || Boolean(fileToOpen)}
          onClose={() => onSearchOpenChange(session.id, false)}
          onMenuAction={(action, context) => onMenuAction(action, context, session.id)}
        />
      )}

      <PreviewDialog
        active={active}
        previewDialog={preview.previewDialog}
        textReloading={preview.textReloading}
        textEncoding={preview.textEncoding}
        onReopenText={(encoding) => void preview.reopenText(encoding)}
        onConvertTextToUtf8={preview.convertTextToUtf8}
        textDraft={preview.textDraft}
        textDirty={preview.textDirty}
        textSaving={preview.textSaving}
        textSaveConfirmation={preview.textSaveConfirmation}
        textSearchRef={textSearchRef}
        onClosePreview={preview.closePreview}
        onOpenExternalLink={onOpenExternalLink}
        onUpdateTextDraft={preview.updateTextDraft}
        onRequestTextSave={preview.requestTextSave}
      />

      {active && fileToOpen && (
        <FileOpenDialog
          name={fileToOpen.name}
          types={previewTypesForFile(fileToOpen.name, fileTypeExtensions)}
          onClose={() => setFileToOpen(null)}
          onSelect={(type) => {
            setFileToOpen(null)
            void preview.previewFile(fileToOpen, type)
          }}
        />
      )}

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
          title={tr('connections.discardUnsavedChanges')}
          description={tr('connections.closingThePreviewDiscardsUnsavedChanges')}
          tone="warning"
          confirmLabel={tr('connections.discardChangesAndSearch')}
          cancelLabel={tr('connections.continueEditing')}
          onConfirm={() => { setConfirmDiscardForSearch(false); openSearch() }}
          onCancel={() => {
            setConfirmDiscardForSearch(false)
            workspaceRef.current?.querySelector<HTMLTextAreaElement>('.text-preview-editor')?.focus()
          }}
        />
      )}

      {active && preview.textSaveConfirmation?.kind === 'install' && (
        <TextSaveInstallDialog
          path={preview.textSaveConfirmation.path}
          packages={preview.textSaveConfirmation.packages}
          passwordRequired={preview.textSaveConfirmation.passwordRequired}
          busy={preview.textSaving}
          error={preview.textSaveError}
          onConfirm={preview.confirmTextSave}
          onCancel={preview.cancelTextSave}
        />
      )}

      {active && preview.textSaveConfirmation && preview.textSaveConfirmation.kind !== 'install' && (
        <ConfirmationDialog
          eyebrow={tr('previews.saveRemoteFile')}
          title={tr('connections.saveChangesTo', { "name": preview.textSaveConfirmation.name })}
          details={[{ label: tr('common.remotePath'), value: preview.textSaveConfirmation.path }]}
          description={tr('connections.savingReplacesTheFileOnTheServerWithTheEdited')}
          tone="warning"
          confirmLabel={preview.textSaveConfirmation.kind === 'conflict' ? tr('connections.forceOverwriteServerFile') : tr('connections.saveChanges')}
          busyLabel={tr('previews.saving')}
          error={preview.textSaveError}
          errorLabel={tr('connections.saveFailed')}
          busy={preview.textSaving}
          onConfirm={() => void preview.confirmTextSave()}
          onCancel={preview.cancelTextSave}
        />
      )}
    </div>
  )
}
