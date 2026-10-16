import type { KeyboardEvent } from 'react'
import type { PreviewResult } from '@shared/types'

interface MediaPreviewPanelProps {
  result: Extract<PreviewResult, { type: 'audio' | 'video' }>
}

export default function MediaPreviewPanel({ result }: MediaPreviewPanelProps) {
  if (result.type === 'audio') {
    return <div className="preview-audio-wrap"><audio controls src={result.url}>浏览器不支持音频播放。</audio></div>
  }

  const onKeyDown = (event: KeyboardEvent<HTMLVideoElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const video = event.currentTarget
    const nextTime = Math.max(0, video.currentTime + (event.key === 'ArrowRight' ? 5 : -5))
    video.currentTime = Number.isFinite(video.duration) ? Math.min(video.duration, nextTime) : nextTime
  }

  return (
    <div className="preview-media">
      <video className="preview-video" controls tabIndex={0} src={result.url} onKeyDown={onKeyDown}>浏览器不支持视频播放。</video>
    </div>
  )
}
