import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FileTypeExtensions, RemoteEntry, TextEncoding, TextFileVersion, TextLineEnding } from '@shared/types'
import type { PreviewType } from '@shared/file-type-registry'
import { previewTypesForFile } from '@shared/preview-file-type'
import type { LogPreviewDialog, PreviewDialog } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UsePreviewOptions {
  sessionId: string | null
  fileTypeExtensions: FileTypeExtensions
  showToast: (kind: ToastNotice['kind'], message: string) => void
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

export function usePreview({ sessionId, fileTypeExtensions, showToast }: UsePreviewOptions) {
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null)
  const [logPreviewDialog, setLogPreviewDialog] = useState<LogPreviewDialog | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const [textEncoding, setTextEncoding] = useState<TextEncoding>('utf8')
  const [textConflict, setTextConflict] = useState(false)
  const [textReloading, setTextReloading] = useState(false)
  const [textDirty, setTextDirty] = useState(false)
  const [textSaving, setTextSaving] = useState(false)
  const [textSaveConfirmation, setTextSaveConfirmation] = useState<{ name: string; path: string } | null>(null)
  const [textSaveError, setTextSaveError] = useState<string | null>(null)
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
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    if (token) void window.remoteFiles.releasePreview(token)
  }, [])

  const closePreview = useCallback(() => {
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
    setTextConflict(false)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }, [])

  const previewFile = useCallback(async (entry: Pick<RemoteEntry, 'name' | 'path'>, type: PreviewType) => {
    closePreview()
    if (!previewTypesForFile(entry.name, fileTypeExtensions).includes(type)) {
      showToast('info', '暂不支持的文件类型：' + entry.name)
      return
    }
    if (!sessionId) return

    const requestId = previewRequestRef.current
    setPreviewDialog({ kind: 'loading', name: entry.name })
    try {
      const result = await window.remoteFiles.previewFile(sessionId, entry.path, type)
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
        showToast('error', '预览失败：' + errorMessage(error))
      }
    }
  }, [closePreview, fileTypeExtensions, sessionId, showToast])

  const previewLogFile = useCallback(async (entry: Pick<RemoteEntry, 'name' | 'path'>) => {
    closePreview()
    if (!sessionId) return

    const activeSessionId = sessionId
    const requestId = previewRequestRef.current
    updateLogPreview({ kind: 'loading', name: entry.name })
    try {
      const page = await window.remoteFiles.readLogPreview(activeSessionId, entry.path)
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
        showToast('error', '倒序预览失败：' + errorMessage(error))
      }
    }
  }, [closePreview, sessionId, showToast])

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
        showToast('error', '读取更早日志失败：' + errorMessage(error))
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
    setTextConflict(false)
    setTextSaveConfirmation({ name: context.name, path: context.path })
  }

  const cancelTextSave = () => {
    if (textSaving) return
    setTextSaveConfirmation(null)
    setTextSaveError(null)
  }

  const confirmTextSave = async () => {
    const context = textPreviewRef.current
    if (!context || textSaving || !textSaveConfirmation) return
    const content = textDraftRef.current
    if (content === context.originalContent && textEncoding === context.encoding) {
      setTextSaveConfirmation(null)
      return
    }

    setTextSaving(true)
    setTextSaveError(null)
    try {
      const result = await window.remoteFiles.saveTextFile(context.sessionId, context.path, content, context.lineEnding, {
        version: context.version, encoding: textEncoding, bom: textEncoding === 'utf8' && context.bom, force: textConflict,
      })
      if (result.status === 'conflict') {
        setTextConflict(true)
        setTextSaveError('服务器文件已变化。可取消后重新加载，或明确选择强制覆盖。当前草稿已保留。')
        return
      }
      context.version = result.version
      context.encoding = textEncoding
      context.bom = textEncoding === 'utf8' && context.bom
      if (textPreviewRef.current !== context) return
      context.originalContent = content
      setTextDirty(textDraftRef.current !== content)
      setTextSaveConfirmation(null)
      showToast('info', '文件已保存')
    } catch (error) {
      if (textPreviewRef.current === context) setTextSaveError(errorMessage(error))
    } finally {
      if (textPreviewRef.current === context) setTextSaving(false)
    }
  }

  return {
    textEncoding,
    textReloading,
    textConflict,
    convertTextToUtf8: () => {
      setTextEncoding('utf8')
      const context = textPreviewRef.current
      if (context) setTextDirty(textDraftRef.current !== context.originalContent || context.encoding !== 'utf8')
    },
    reopenText: async (encoding: TextEncoding) => {
      const context = textPreviewRef.current
      if (!context || textSaving || textReloading) return
      if (textDirty && !window.confirm('重新加载将放弃当前草稿，是否继续？')) return
      const requestId = ++previewRequestRef.current
      setTextReloading(true)
      try {
        const result = await window.remoteFiles.previewFile(context.sessionId, context.path, 'text', encoding)
        if (previewRequestRef.current !== requestId || textPreviewRef.current !== context || result.type !== 'text') return
        textPreviewRef.current = { ...context, originalContent: result.content, lineEnding: result.lineEnding, encoding: result.encoding, bom: result.bom, version: result.version }
        textDraftRef.current = result.content
        setTextDraft(result.content)
        setTextEncoding(result.encoding)
        setTextDirty(false)
        setTextConflict(false)
        setPreviewDialog({ kind: 'ready', result })
      } catch (error) { showToast('error', '重新读取失败：' + errorMessage(error)) }
      finally { if (previewRequestRef.current === requestId) setTextReloading(false) }
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
