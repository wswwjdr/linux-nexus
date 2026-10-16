import type { RefObject, SyntheticEvent, WheelEvent } from 'react'
import type { PreviewResult } from '@shared/types'
import type { ImagePreviewSize } from '@/app-types'

interface ImagePreviewPanelProps {
  result: Extract<PreviewResult, { type: 'image' }>
  zoom: number
  imageSize: ImagePreviewSize | null
  viewportRef: RefObject<HTMLDivElement | null>
  imageRef: RefObject<HTMLImageElement | null>
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  onZoom: (event: WheelEvent<HTMLDivElement>) => void
}

export default function ImagePreviewPanel({
  result,
  zoom,
  imageSize,
  viewportRef,
  imageRef,
  onImageLoad,
  onZoom,
}: ImagePreviewPanelProps) {
  return (
    <div className="preview-media image-preview-viewport" ref={viewportRef} onWheel={onZoom}>
      <div
        className="preview-image-canvas"
        style={{
          width: Math.max(viewportRef.current?.clientWidth ?? 0, (imageSize?.width ?? 0) * zoom) + 'px',
          height: Math.max(viewportRef.current?.clientHeight ?? 0, (imageSize?.height ?? 0) * zoom) + 'px',
        }}
      >
        <img
          ref={imageRef}
          className="preview-image"
          src={result.url}
          alt={result.name}
          draggable={false}
          style={imageSize
            ? { width: imageSize.width * zoom + 'px', height: imageSize.height * zoom + 'px' }
            : { maxWidth: '100%', maxHeight: '100%' }}
          onLoad={onImageLoad}
        />
      </div>
    </div>
  )
}
