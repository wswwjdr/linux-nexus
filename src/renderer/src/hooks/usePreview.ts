import { useEffect, useLayoutEffect, useRef, useState, type SyntheticEvent, type WheelEvent } from 'react'
import type { RemoteEntry } from '@shared/types'
import { previewFileType } from '@shared/preview-file-type'
import type { ImagePreviewSize, LogPreviewDialog, PreviewDialog } from '@/app-types'
import type { ToastNotice } from '@/GlobalToast'
import { errorMessage } from '@/app-utils'

interface UsePreviewOptions {
  sessionId: string | null
  showToast: (kind: ToastNotice['kind'], message: string) => void
}

export function usePreview({ sessionId, showToast }: UsePreviewOptions) {
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null)
  const [logPreviewDialog, setLogPreviewDialog] = useState<LogPreviewDialog | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePreviewSize, setImagePreviewSize] = useState<ImagePreviewSize | null>(null)
  const previewTokenRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const imageViewportRef = useRef<HTMLDivElement>(null)
  const previewImageRef = useRef<HTMLImageElement>(null)
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
    if (previewTokenRef.current) void window.remoteFiles.releasePreview(previewTokenRef.current)
  }, [])

  const closePreview = () => {
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    setPreviewDialog(null)
    updateLogPreview(null)
    logScrollRestoreRef.current = null
    logStartAtBottomRef.current = false
    setImageZoom(1)
    setImagePreviewSize(null)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }

  const previewFile = async (entry: RemoteEntry) => {
    closePreview()
    if (!previewFileType(entry.name)) {
      showToast('info', '暂不支持的文件类型：' + entry.name)
      return
    }
    if (!sessionId) return

    const requestId = previewRequestRef.current
    setPreviewDialog({ kind: 'loading', name: entry.name })
    try {
      const result = await window.remoteFiles.previewFile(sessionId, entry.path)
      if (requestId !== previewRequestRef.current) {
        if (result.type !== 'text') void window.remoteFiles.releasePreview(result.token)
        return
      }
      if (result.type !== 'text') previewTokenRef.current = result.token
      setPreviewDialog({ kind: 'ready', result })
    } catch (error) {
      if (requestId === previewRequestRef.current) {
        setPreviewDialog(null)
        showToast('error', '预览失败：' + errorMessage(error))
      }
    }
  }

  const previewLogFile = async (entry: RemoteEntry) => {
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
  }

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

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const viewport = imageViewportRef.current
    if (!viewport) return
    const maxWidth = Math.max(1, viewport.clientWidth - 32)
    const maxHeight = Math.max(1, viewport.clientHeight - 32)
    const fit = Math.min(1, maxWidth / event.currentTarget.naturalWidth, maxHeight / event.currentTarget.naturalHeight)
    setImagePreviewSize({
      width: event.currentTarget.naturalWidth * fit,
      height: event.currentTarget.naturalHeight * fit,
    })
    setImageZoom(1)
  }

  const zoomImage = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    const viewport = imageViewportRef.current
    const image = previewImageRef.current
    if (!viewport || !image || !imagePreviewSize) return
    const nextZoom = Math.max(0.25, Math.min(4, imageZoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15)))
    if (nextZoom === imageZoom) return

    const imageBounds = image.getBoundingClientRect()
    const viewportBounds = viewport.getBoundingClientRect()
    const anchorX = (event.clientX - imageBounds.left) / imageZoom
    const anchorY = (event.clientY - imageBounds.top) / imageZoom
    const pointerX = event.clientX - viewportBounds.left
    const pointerY = event.clientY - viewportBounds.top
    const canvasWidth = Math.max(viewport.clientWidth, imagePreviewSize.width * nextZoom)
    const canvasHeight = Math.max(viewport.clientHeight, imagePreviewSize.height * nextZoom)
    setImageZoom(nextZoom)
    window.requestAnimationFrame(() => {
      if (imageViewportRef.current !== viewport) return
      viewport.scrollLeft = (canvasWidth - imagePreviewSize.width * nextZoom) / 2 + anchorX * nextZoom - pointerX
      viewport.scrollTop = (canvasHeight - imagePreviewSize.height * nextZoom) / 2 + anchorY * nextZoom - pointerY
    })
  }

  return {
    previewDialog,
    logPreviewDialog,
    imageZoom,
    imagePreviewSize,
    imageViewportRef,
    previewImageRef,
    logViewportRef,
    closePreview,
    previewFile,
    previewLogFile,
    onLogPreviewScroll,
    onImageLoad,
    zoomImage,
  }
}
