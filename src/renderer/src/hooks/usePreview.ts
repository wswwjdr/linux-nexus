import { useEffect, useRef, useState, type SyntheticEvent, type WheelEvent } from 'react'
import type { RemoteEntry } from '@shared/types'
import type { ImagePreviewSize, PreviewDialog } from '../app-types'
import type { ToastNotice } from '../GlobalToast'
import { errorMessage } from '../app-utils'

interface UsePreviewOptions {
  connectedProfileId: string | null
  showToast: (kind: ToastNotice['kind'], message: string) => void
}

export function usePreview({ connectedProfileId, showToast }: UsePreviewOptions) {
  const [previewDialog, setPreviewDialog] = useState<PreviewDialog | null>(null)
  const [imageZoom, setImageZoom] = useState(1)
  const [imagePreviewSize, setImagePreviewSize] = useState<ImagePreviewSize | null>(null)
  const previewTokenRef = useRef<string | null>(null)
  const previewRequestRef = useRef(0)
  const imageViewportRef = useRef<HTMLDivElement>(null)
  const previewImageRef = useRef<HTMLImageElement>(null)

  useEffect(() => () => {
    if (previewTokenRef.current) void window.remoteFiles.releasePreview(previewTokenRef.current)
  }, [])

  const closePreview = () => {
    previewRequestRef.current += 1
    const token = previewTokenRef.current
    previewTokenRef.current = null
    setPreviewDialog(null)
    setImageZoom(1)
    setImagePreviewSize(null)
    if (token) window.setTimeout(() => void window.remoteFiles.releasePreview(token), 0)
  }

  const previewFile = async (entry: RemoteEntry) => {
    closePreview()
    const supportedExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.txt', '.sh', '.mp3', '.mp4'])
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()
    if (!supportedExtensions.has(extension)) {
      showToast('info', '暂不支持的文件类型：' + entry.name)
      return
    }
    if (!connectedProfileId) return

    const requestId = previewRequestRef.current
    setPreviewDialog({ kind: 'loading', name: entry.name })
    try {
      const result = await window.remoteFiles.previewFile(connectedProfileId, entry.path)
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
    imageZoom,
    imagePreviewSize,
    imageViewportRef,
    previewImageRef,
    closePreview,
    previewFile,
    onImageLoad,
    zoomImage,
  }
}
