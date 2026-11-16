import { msg, type MessageValue, tr } from '@shared/i18n/messages'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FileTypeExtensions, RemoteEntry, TextEncoding, TextFileVersion, TextLineEnding } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { previewTypesForFile } from '@shared/preview-file-type'
import type { LogPreviewDialog, PreviewDialog } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'
import { DependencyCancelledError, useFileDependencyAction } from '@/features/dependencies/DependencyProvider'

interface UsePreviewOptions {
  sessionId: string | null
  fileTypeExtensions: FileTypeExtensions
  showToast: (kind: ToastNotice['kind'], message: MessageValue) => void
}

interface TextPreviewContext {
  sessionId: string
  path: string
  name: string
  originalContent: string
  lineEnding: TextLineEnding
  encoding: TextEncoding
  bom: boolean
  version: TextFileVersion
}

type TextSaveConfirmation = { name: string; path: string; kind: 'save' | 'conflict' }

export function usePreview({ sessionId, fileTypeExtensions, showToast }: UsePreviewOptions) {
  const withDependencies = useFileDependencyAction()
  const dependencyWait = useRef<AbortController | null>(null)
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null)
  const [logPreviewDialog, setLogPreviewDialog] = useState<LogPreviewDialog | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [textEncoding, setTextEncoding] = useState<TextEncoding>('utf8')
  const [textReloading, setTextReloading] = useState(false)
  const [textDirty, setTextDirty] = useState(false)
  const [textSaving, setTextSaving] = useState(false)
  const [textSaveConfirmation, setTextSaveConfirmation] = useState<TextSaveConfirmation | null>(null)
  const [textSaveError, setTextSaveError] = useState<MessageValue | null>(null)
  const previewTokenRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const textPreviewRef = useRef<TextPreviewContext | null>(null)
  const textDraftRef = useRef('')
  const logPreviewRef = useRef<LogPreviewDialog | null>(null)
  const logViewportRef = useRef<HTMLPreElement>(null)
  const logScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const logStartAtBottomRef = useRef(false)

  const updateLogPreview = (dialog: LogPreviewDialog | null) => {
    logPreviewRef.current = dialog
    setLogPreviewDialog(dialog)
  }

  useLayoutEffect(() => {
    if (logPreviewDialog?.kind !== 'ready') return
    const viewport = logViewportRef.current
    if (!viewport) return
    const restore = logScrollRestoreRef.current
    if (restore) {
      viewport.scrollTop = restore.scrollTop + viewport.scrollHeight - restore.scrollHeight
      logScrollRestoreRef.current = null
      return
    }
    if (logStartAtBottomRef.current) {
      viewport.scrollTop = viewport.scrollHeight
      logStartAtBottomRef.current = false
    }
  }, [logPreviewDialog])

  useEffect(() => () => {
    dependencyWait.current?.abort()
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    if (token) void window.remoteFiles.releasePreview(token)
  }, [])

  const closePreview = useCallback(() => {
    dependencyWait.current?.abort()
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    setPreviewDialog(null)
    updateLogPreview(null)
    logScrollRestoreRef.current = null
    logStartAtBottomRef.current = false
    textPreviewRef.current = null
    textDraftRef.current = ''
    setTextDraft('')
    setTextDirty(false)
    setTextSaving(false)
    setTextReloading(false)
    setTextSaveConfirmation(null)
    setTextSaveError(null)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }, [])

  const previewFile = useCallback(async (entry: Pick<RemoteEntry, 'name' | 'path'>, type: PreviewType) => {
    closePreview()
    if (!previewTypesForFile(entry.name, fileTypeExtensions).includes(type)) {
      showToast('info', msg('connections.unsupportedFileType', { "name": entry.name }))
      return
    }
    if (!sessionId) return

    const requestId = previewRequestRef.current
    const controller = new AbortController()
    dependencyWait.current = controller
    setPreviewDialog({ kind: 'loading', name: entry.name })
    try {
      const result = await withDependencies(() => window.remoteFiles.previewFile(sessionId, entry.path, type), sessionId, entry.path, controller.signal)
      if (requestId !== previewRequestRef.current) {
        if ('token' in result) void window.remoteFiles.releasePreview(result.token)
        return
      }
      if (result.type === 'text') {
        textPreviewRef.current = {
          sessionId,
          path: entry.path,
          name: result.name,
          originalContent: result.content,
          lineEnding: result.lineEnding,
          encoding: result.encoding, bom: result.bom, version: result.version,
        }
        setTextEncoding(result.encoding)
        textDraftRef.current = result.content
        setTextDraft(result.content)
      } else if ('token' in result) {
        previewTokenRef.current = result.token
      }
      setPreviewDialog({ kind: 'ready', result })
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        setPreviewDialog(null)
        if (!(error instanceof DependencyCancelledError)) showToast('error', msg('previews.previewFailed', { "value1": errorMessage(error) }))
      }
    } finally { if (dependencyWait.current === controller) dependencyWait.current = null }
  }, [closePreview, fileTypeExtensions, sessionId, showToast, withDependencies])

  const previewLogFile = useCallback(async (entry: Pick<RemoteEntry, 'name' | 'path'>) => {
    closePreview()
    if (!sessionId) return

    const activeSessionId = sessionId
    const requestId = previewRequestRef.current
    const controller = new AbortController()
    dependencyWait.current = controller
    updateLogPreview({ kind: 'loading', name: entry.name })
    try {
      const page = await withDependencies(() => window.remoteFiles.readLogPreview(activeSessionId, entry.path), activeSessionId, entry.path, controller.signal)
      if (requestId !== previewRequestRef.current) return
      logStartAtBottomRef.current = true
      updateLogPreview({
        ...page,
        kind: 'ready',
        sessionId: activeSessionId,
        path: entry.path,
        loadingEarlier: false,
      })
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        updateLogPreview(null)
        if (!(error instanceof DependencyCancelledError)) showToast('error', msg('previews.reversePreviewFailed', { "value1": errorMessage(error) }))
      }
    } finally { if (dependencyWait.current === controller) dependencyWait.current = null }
  }, [closePreview, sessionId, showToast, withDependencies])

  const loadEarlierLogPreview = async () => {
    const current = logPreviewRef.current
    if (current?.kind !== 'ready' || !current.hasEarlier || current.loadingEarlier) return
    const requestId = previewRequestRef.current
    updateLogPreview({ ...current, loadingEarlier: true })
    try {
      const page = await window.remoteFiles.readLogPreview(
        current.sessionId,
        current.path,
        current.startOffset,
        current.fileSize,
      )
      if (requestId !== previewRequestRef.current) return
      const previous = logPreviewRef.current
      if (previous?.kind !== 'ready') return
      const viewport = logViewportRef.current
      if (viewport) {
        logScrollRestoreRef.current = { scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
      }
      updateLogPreview({
        ...page,
        kind: 'ready',
        sessionId: current.sessionId,
        path: current.path,
        content: page.content + previous.content,
        loadingEarlier: false,
      })
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        const latest = logPreviewRef.current
        if (latest?.kind === 'ready') updateLogPreview({ ...latest, loadingEarlier: false })
        showToast('error', msg('previews.couldNotReadEarlierLogEntries', { "value1": errorMessage(error) }))
      }
    }
  }

  const onLogPreviewScroll = () => {
    const viewport = logViewportRef.current
    if (viewport && viewport.scrollTop <= 48) void loadEarlierLogPreview()
  }

  const updateTextDraft = (content: string) => {
    const context = textPreviewRef.current
    if (!context || textSaving || textReloading) return
    textDraftRef.current = content
    setTextDraft(content)
    setTextDirty(content !== context.originalContent || textEncoding !== context.encoding)
  }

  const requestTextSave = () => {
    const context = textPreviewRef.current
    if (!context || textSaving || textDraftRef.current === context.originalContent && textEncoding === context.encoding) return
    setTextSaveError(null)
    setTextSaveConfirmation({ name: context.name, path: context.path, kind: 'save' })
  }

  const cancelTextSave = () => {
    if (textSaving) return
    setTextSaveConfirmation(null)
    setTextSaveError(null)
  }

  /** Confirms the current save or force overwrite and resumes it after dependency preparation if necessary. */
  const confirmTextSave = async () => {
    const context = textPreviewRef.current
    const confirmation = textSaveConfirmation
    if (!context || textSaving || !confirmation) return
    const content = textDraftRef.current
    if (content === context.originalContent && textEncoding === context.encoding) {
      setTextSaveConfirmation(null)
      return
    }

    const requestId = previewRequestRef.current
    const isCurrent = () => requestId === previewRequestRef.current && textPreviewRef.current === context
    const file = { name: context.name, path: context.path }
    const force = confirmation.kind === 'conflict'
    const controller = new AbortController()
    dependencyWait.current = controller
    setTextSaving(true)
    setTextSaveError(null)
    try {
      /** Saves the captured draft and version so a retry preserves the original conflict check. */
      const save = () => window.remoteFiles.saveTextFile(context.sessionId, context.path, content, context.lineEnding, {
        version: context.version, encoding: textEncoding, bom: textEncoding === 'utf8' && context.bom, force,
      })
      const result = await withDependencies(save, context.sessionId, context.path, controller.signal, () => setTextSaveConfirmation(null))
      if (!isCurrent()) return
      if (result.status === 'conflict') {
        setTextSaveConfirmation({ ...file, kind: 'conflict' })
        setTextSaveError(msg('previews.theServerFileChangedCancelAndReloadOrExplicitlyChoose'))
        return
      }
      context.version = result.version
      context.encoding = textEncoding
      context.bom = textEncoding === 'utf8' && context.bom
      context.originalContent = content
      setTextDirty(textDraftRef.current !== content)
      setTextSaveConfirmation(null)
      showToast('info', msg('previews.fileSaved'))
    } catch (error) {
      if (isCurrent() && !(error instanceof DependencyCancelledError)) {
        setTextSaveConfirmation(confirmation)
        setTextSaveError(errorMessage(error))
      }
    } finally {
      if (isCurrent()) {
        dependencyWait.current = null
        setTextSaving(false)
      }
    }
  }

  return {
    textEncoding,
    textReloading,
    convertTextToUtf8: () => {
      setTextEncoding('utf8')
      const context = textPreviewRef.current
      if (context) setTextDirty(textDraftRef.current !== context.originalContent || context.encoding !== 'utf8')
    },
    reopenText: async (encoding: TextEncoding) => {
      const context = textPreviewRef.current
      if (!context || textSaving || textReloading) return
      if (textDirty && !window.confirm(tr('previews.reloadingDiscardsTheCurrentDraftContinue'))) return
      const requestId = ++previewRequestRef.current
      const controller = new AbortController()
      dependencyWait.current = controller
      setTextReloading(true)
      try {
        const result = await withDependencies(() => window.remoteFiles.previewFile(context.sessionId, context.path, 'text', encoding), context.sessionId, context.path, controller.signal)
        if (previewRequestRef.current !== requestId || textPreviewRef.current !== context || result.type !== 'text') return
        textPreviewRef.current = { ...context, originalContent: result.content, lineEnding: result.lineEnding, encoding: result.encoding, bom: result.bom, version: result.version }
        textDraftRef.current = result.content
        setTextDraft(result.content)
        setTextEncoding(result.encoding)
        setTextDirty(false)
        setPreviewDialog({ kind: 'ready', result })
      } catch (error) {
        if (previewRequestRef.current === requestId && !(error instanceof DependencyCancelledError)) showToast('error', msg('previews.couldNotReload', { "value1": errorMessage(error) }))
      } finally {
        if (dependencyWait.current === controller) dependencyWait.current = null
        if (previewRequestRef.current === requestId) setTextReloading(false)
      }
    },
    previewDialog,
    logPreviewDialog,
    textDraft,
    textDirty,
    textSaving,
    textSaveConfirmation,
    textSaveError,
    logViewportRef,
    closePreview,
    previewFile,
    previewLogFile,
    onLogPreviewScroll,
    updateTextDraft,
    requestTextSave,
    confirmTextSave,
    cancelTextSave,
  }
}
