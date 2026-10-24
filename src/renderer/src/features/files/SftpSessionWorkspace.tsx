import { useEffect } from 'react'
import type { FileTypeExtensions, RemoteEntry } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import ConfirmationDialog from '@/components/ConfirmationDialog'
import LogPreviewDialog from '@/components/previews/LogPreviewDialog'
import PreviewDialog from '@/components/previews/PreviewDialog'
import SearchDialog from '@/features/search/SearchDialog'
import { usePreview } from '@/hooks/usePreview'
import type { SessionTab } from '@/app-types'
import type { SftpContextMenuContext, SftpMenuAction } from './sftp-menu'
import type { ToastNotice } from '@/GlobalToast'

export interface SessionPreviewActions {
  previewFile: (entry: Pick<RemoteEntry, 'name' | 'path'>, type: PreviewType) => Promise<void>
  previewLogFile: (entry: Pick<RemoteEntry, 'name' | 'path'>) => Promise<void>
}

interface SftpSessionWorkspaceProps {
  session: SessionTab
  active: boolean
  searchOpen: boolean
  fileTypeExtensions: FileTypeExtensions
  showToast: (kind: ToastNotice['kind'], message: string) => void
  onSearchOpenChange: (sessionId: string, open: boolean) => void
  onWorkspaceOpenChange: (sessionId: string, open: boolean) => void
  onBlockingChange: (sessionId: string, blocking: boolean) => void
  onRegisterPreviewActions: (sessionId: string, actions: SessionPreviewActions | null) => void
  onMenuAction: (action: SftpMenuAction, context: SftpContextMenuContext, sessionId: string) => void
  onOpenExternalLink: (url: string) => void
}

export default function SftpSessionWorkspace({
  session,
  active,
  searchOpen,
  fileTypeExtensions,
  showToast,
  onSearchOpenChange,
  onWorkspaceOpenChange,
  onBlockingChange,
  onRegisterPreviewActions,
  onMenuAction,
  onOpenExternalLink,
}: SftpSessionWorkspaceProps) {
  const preview = usePreview({
    sessionId: session.status === 'connected' ? session.id : null,
    fileTypeExtensions,
    showToast,
  })

  useEffect(() => {
    onRegisterPreviewActions(session.id, {
      previewFile: preview.previewFile,
      previewLogFile: preview.previewLogFile,
    })
    return () => onRegisterPreviewActions(session.id, null)
  }, [onRegisterPreviewActions, preview.previewFile, preview.previewLogFile, session.id])

  useEffect(() => {
    if (session.status !== 'disconnected') return
    preview.closePreview()
    onSearchOpenChange(session.id, false)
  }, [session.id, session.status])

  useEffect(() => {
    onBlockingChange(session.id, active && Boolean(preview.textSaveConfirmation))
    return () => onBlockingChange(session.id, false)
  }, [active, onBlockingChange, preview.textSaveConfirmation, session.id])

  useEffect(() => {
    onWorkspaceOpenChange(session.id, active && (searchOpen || Boolean(preview.previewDialog || preview.logPreviewDialog)))
    return () => onWorkspaceOpenChange(session.id, false)
  }, [active, onWorkspaceOpenChange, preview.logPreviewDialog, preview.previewDialog, searchOpen, session.id])

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || preview.textSaveConfirmation) return
      if (!preview.previewDialog && !preview.logPreviewDialog) return
      event.preventDefault()
      preview.closePreview()
    }
    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [preview.closePreview, preview.logPreviewDialog, preview.previewDialog, preview.textSaveConfirmation])

  return (
    <div className={'session-workspace-layer' + (active ? ' active' : '')} aria-hidden={!active}>
      {searchOpen && (
        <SearchDialog
          sessionId={session.id}
          profileId={session.profileId}
          currentPath={session.currentPath}
          visible={active}
          fileTypeExtensions={fileTypeExtensions}
          previewOpen={Boolean(preview.previewDialog || preview.logPreviewDialog)}
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
        onClosePreview={preview.closePreview}
        onLogPreviewScroll={preview.onLogPreviewScroll}
      />

      {active && preview.textSaveConfirmation && (
        <ConfirmationDialog
          eyebrow="保存远程文件"
          title={`覆盖 ${preview.textSaveConfirmation.name}？`}
          details={[{ label: '远程路径', value: preview.textSaveConfirmation.path }]}
          description="确认后将以当前编辑内容覆盖服务器上的源文件。保存前会检查该文件是否已被其他人修改。"
          tone="warning"
          confirmLabel="覆盖并保存"
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
