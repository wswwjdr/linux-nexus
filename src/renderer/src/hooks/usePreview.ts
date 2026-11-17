import { msg, type MessageValue, tr } from '@shared/i18n/messages'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FileTypeExtensions, PreviewResult, RemoteEntry, TextEncoding, TextFileVersion, TextLineEnding } from '@shared/types'
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

type TextPreviewResult = Extract<PreviewResult, { type: 'text' }>
type TextConflict = { name: string; path: string; version: TextFileVersion; error?: MessageValue }

/**
 * Manages one workspace's previews, editable draft and remote save conflicts.
 * @param options Current session, supported extensions and notification callback.
 * @returns Preview state and the actions for each preview entry point.
 */
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
  const [textConflict, setTextConflict] = useState<TextConflict | null>(null)
  const previewTokenRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const textPreviewRef = useRef<TextPreviewContext | null>(null)
  const textDraftRef = useRef('')
  const logPreviewRef = useRef<LogPreviewDialog | null>(null)
  const logViewportRef = useRef<HTMLPreElement>(null)
  const logScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const logStartAtBottomRef = useRef(false)

  /**
   * Installs a fresh source snapshot and initializes the editor's LF-normalized draft.
   * @param sessionId File session that owns the snapshot.
   * @param path Remote source path.
   * @param result Decoded snapshot and editing metadata.
   */
  const applyTextSnapshot = useCallback((sessionId: string, path: string, result: TextPreviewResult) => {
    const content = result.content.replace(/\r\n|\r/g, '\n')
    textPreviewRef.current = {
      sessionId, path, name: result.name, originalContent: content, lineEnding: result.lineEnding,
      encoding: result.encoding, bom: result.bom, version: result.version,
    }
    textDraftRef.current = content
    setTextDraft(content)
    setTextEncoding(result.encoding)
    setTextDirty(false)
    setTextConflict(null)
    setPreviewDialog({ kind: 'ready', result })
  }, [])

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

  /** Closes the current preview and releases its request, draft and resources. */
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
    setTextConflict(null)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }, [])

  /**
   * Opens the selected preview for a remote file entry.
   * @param entry Remote file name and path.
   * @param type Requested preview strategy.
   */
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
        applyTextSnapshot(sessionId, entry.path, result)
      } else {
        if ('token' in result) previewTokenRef.current = result.token
        setPreviewDialog({ kind: 'ready', result })
      }
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        setPreviewDialog(null)
        if (!(error instanceof DependencyCancelledError)) showToast('error', msg('previews.previewFailed', { "value1": errorMessage(error) }))
      }
    } finally { if (dependencyWait.current === controller) dependencyWait.current = null }
  }, [applyTextSnapshot, closePreview, fileTypeExtensions, sessionId, showToast, withDependencies])

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

  /**
   * Updates the editor draft and tracks whether a write is needed.
   * @param content Current editor value.
   */
  const updateTextDraft = (content: string) => {
    const context = textPreviewRef.current
    if (!context || dependencyWait.current || textConflict) return
    textDraftRef.current = content
    setTextDraft(content)
    setTextDirty(content !== context.originalContent || textEncoding !== context.encoding)
  }

  /**
   * Selects the output encoding without reinterpreting the draft.
   * @param encoding Encoding for the next save.
   */
  const selectTextSaveEncoding = (encoding: TextEncoding) => {
    const context = textPreviewRef.current
    if (!context || dependencyWait.current || textConflict) return
    setTextEncoding(encoding)
    setTextDirty(textDraftRef.current !== context.originalContent || encoding !== context.encoding)
  }

  /**
   * Saves the captured draft against its loaded or explicitly accepted remote version.
   * @param acceptedConflict Conflict the user chose to overwrite, if any.
   */
  const saveText = async (acceptedConflict?: TextConflict) => {
    const context = textPreviewRef.current
    if (!context || dependencyWait.current || (textConflict ?? undefined) !== acceptedConflict) return
    const content = textDraftRef.current
    if (content === context.originalContent && textEncoding === context.encoding) return

    const controller = new AbortController()
    dependencyWait.current = controller
    const version = acceptedConflict?.version ?? context.version
    const bom = textEncoding === 'utf8' && context.bom
    setTextSaving(true)
    try {
      const result = await withDependencies(
        () => window.remoteFiles.saveTextFile(context.sessionId, context.path, content, context.lineEnding, {
          version, encoding: textEncoding, bom,
        }),
        context.sessionId, context.path, controller.signal, () => setTextConflict(null),
      )
      if (textPreviewRef.current !== context) return
      if (result.status === 'conflict') {
        setTextConflict({ name: context.name, path: context.path, version: result.version })
        return
      }
      const lineEnding = context.lineEnding ?? (content.includes('\n') ? '\n' : null)
      applyTextSnapshot(context.sessionId, context.path, {
        type: 'text', name: context.name, content, lineEnding, encoding: textEncoding, bom,
        lossy: false, version: result.version,
      })
      showToast('info', msg('previews.fileSaved'))
    } catch (error) {
      if (textPreviewRef.current !== context) return
      const failure = error instanceof DependencyCancelledError ? undefined : errorMessage(error)
      if (acceptedConflict) setTextConflict({ ...acceptedConflict, error: failure })
      else if (failure) showToast('error', msg('previews.textSaveFailed', { value1: failure }))
    } finally {
      if (dependencyWait.current === controller) {
        dependencyWait.current = null
        setTextSaving(false)
      }
    }
  }

  /**
   * Reloads the source with the selected encoding, keeping the draft if the read fails.
   * @param encoding Explicit decoding choice, or omit for automatic detection.
   * @param conflict Conflict whose reload action already confirmed discarding the draft.
   */
  const reloadText = async (encoding?: TextEncoding, conflict?: TextConflict) => {
    const context = textPreviewRef.current
    if (!context || dependencyWait.current || (textConflict ?? undefined) !== conflict) return
    if (!conflict && textDirty && !window.confirm(tr('previews.reloadingDiscardsTheCurrentDraftContinue'))) return
    const controller = new AbortController()
    dependencyWait.current = controller
    setTextReloading(true)
    try {
      const result = await withDependencies(
        () => window.remoteFiles.previewFile(context.sessionId, context.path, 'text', encoding),
        context.sessionId, context.path, controller.signal, () => setTextConflict(null),
      )
      if (textPreviewRef.current !== context) return
      if (result.type !== 'text') throw new Error('Expected a text preview when reloading a text file')
      applyTextSnapshot(context.sessionId, context.path, result)
    } catch (error) {
      if (textPreviewRef.current !== context) return
      const failure = error instanceof DependencyCancelledError ? undefined : msg('previews.couldNotReload', { value1: errorMessage(error) })
      if (conflict) setTextConflict({ ...conflict, error: failure })
      else if (failure) showToast('error', failure)
    } finally {
      if (dependencyWait.current === controller) {
        dependencyWait.current = null
        setTextReloading(false)
      }
    }
  }

  /** Starts a normal save directly against the loaded source version. */
  const requestTextSave = () => saveText()

  /** Retries the save against the specific version shown by the conflict prompt. */
  const overwriteTextConflict = () => textConflict && saveText(textConflict)

  /** Reloads the latest version when the user chooses to discard the conflict draft. */
  const reloadTextConflict = () => textConflict && reloadText(undefined, textConflict)

  /** Dismisses the conflict prompt while retaining the current draft. */
  const dismissTextConflict = () => {
    if (!dependencyWait.current) setTextConflict(null)
  }

  return {
    textEncoding,
    textReloading,
    selectTextSaveEncoding,
    reopenText: reloadText,
    previewDialog,
    logPreviewDialog,
    textDraft,
    textDirty,
    textSaving,
    textConflict,
    logViewportRef,
    closePreview,
    previewFile,
    previewLogFile,
    onLogPreviewScroll,
    updateTextDraft,
    requestTextSave,
    overwriteTextConflict,
    reloadTextConflict,
    dismissTextConflict,
  }
}
