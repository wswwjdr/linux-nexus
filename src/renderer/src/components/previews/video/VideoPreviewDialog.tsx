import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Video } from 'lucide-react'
import videojs from 'video.js'
import zhCN from 'video.js/dist/lang/zh-CN.json'
import type Player from 'video.js/dist/types/player'
import type { PreviewResult } from '@shared/types'
import { previewMimeType } from '@shared/preview-mime-type'
import { MediaPreviewHeader, MediaShortcuts } from '../media/MediaPreviewHeader'
import { audioShortcutGroups } from '../audio/useAudioShortcuts'
import { playbackFailure } from '../media/media-controls'
import { useVideoShortcuts } from './useVideoShortcuts'

videojs.addLanguage('zh-CN', zhCN)
const shortcutGroups = audioShortcutGroups.map((group, index) => ({ ...group, items: index === 0
  ? [...group.items, { keys: ['F'], description: '全屏模式' }]
  : index === 1 ? [...group.items, { keys: ['长按 →'], description: '临时 2x 倍速' }] : group.items }))

export default function VideoPreviewDialog({ result, active, onClose }: {
  result: Extract<PreviewResult, { type: 'video' }>; active: boolean; onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const playerRef = useRef<Player | null>(null)
  const activeRef = useRef(active)
  const mayAutoplay = useRef(active)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null)
  const titleId = useId()
  const shortcutsId = useId()
  const report = useCallback((message: string) => setNotice({ error: true, message }), [])
  const play = useCallback(() => {
    const player = playerRef.current!
    setNotice(null)
    void player.play()?.then(() => {
      if (!player.isDisposed() && !activeRef.current) player.pause()
    }, (error: unknown) => {
      if (player.isDisposed() || !activeRef.current) return
      const failure = playbackFailure(error, '视频')
      if (failure) setNotice(failure)
    })
  }, [])

  useLayoutEffect(() => {
    activeRef.current = active
    if (!active) {
      mayAutoplay.current = false
      playerRef.current?.pause()
      if (document.fullscreenElement && dialogRef.current!.contains(document.fullscreenElement)) {
        void document.exitFullscreen().catch((error: unknown) => report('退出全屏失败：' + String(error)))
      }
    }
  }, [active, report])

  useEffect(() => {
    const previousFocus = document.activeElement
    const element = document.createElement('video-js')
    element.className = 'video-js vjs-big-play-centered'
    hostRef.current!.append(element)
    const player = videojs(element, {
      controls: true, autoplay: false, preload: 'metadata', fluid: false, fill: true, language: 'zh-CN',
      playbackRates: [.5, 1, 1.5, 2], userActions: { hotkeys: false },
      sources: [{ src: result.url, type: previewMimeType('video', result.name) }],
    })
    playerRef.current = player
    player.on('play', () => {
      if (!activeRef.current) player.pause()
      else setNotice(null)
    })
    player.on('error', () => {
      const error = player.error()!
      report('视频加载或解码失败：' + error.message)
    })
    const initiallyActive = activeRef.current
    player.one('loadedmetadata', () => {
      if (!player.isDisposed() && mayAutoplay.current && activeRef.current) play()
    })
    if (initiallyActive) dialogRef.current!.focus()
    return () => {
      player.pause()
      player.dispose()
      playerRef.current = null
      if (activeRef.current && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [result.url, result.name, play, report])
  useVideoShortcuts(playerRef, dialogRef, active, play, report)

  const close = () => { playerRef.current!.pause(); onClose() }
  return <div className="modal-backdrop preview-backdrop ap-overlay vp-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="ap-modal vp-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} inert={!active}>
      <MediaPreviewHeader title={result.name} titleId={titleId} icon={<Video size={20} />} showShortcuts={showShortcuts} shortcutsId={shortcutsId} onToggleShortcuts={() => setShowShortcuts(!showShortcuts)} onClose={close} />
      <div className="vp-content"><MediaShortcuts id={shortcutsId} open={showShortcuts} groups={shortcutGroups} />
        <div className="vp-player-container" ref={hostRef} />
        {notice && <p className="vp-notice" role={notice.error ? 'alert' : 'status'}>{notice.message}</p>}
      </div>
    </section>
  </div>
}
