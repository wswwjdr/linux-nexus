import { type MessageValue, i18n, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
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
  ? [...group.items, { keys: ['F'], description: tr('previews.fullscreenMode') }]
  : index === 1 ? [...group.items, { keys: [tr('previews.hold')], description: tr('previews.temporary2xSpeed') }] : group.items }))

export default function VideoPreviewDialog({ result, active, onClose }: {
  result: Extract<PreviewResult, { type: 'video' }>; active: boolean; onClose: () => void
}) {
  const language = useLanguage()
  const hostRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const playerRef = useRef<Player | null>(null)
  const activeRef = useRef(active)
  const mayAutoplay = useRef(active)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; message: MessageValue } | null>(null)
  const titleId = useId()
  const shortcutsId = useId()
  const report = useCallback((message: MessageValue) => setNotice({ error: true, message }), [])
  const play = useCallback(() => {
    const player = playerRef.current!
    setNotice(null)
    void player.play()?.then(() => {
      if (!player.isDisposed() && !activeRef.current) player.pause()
    }, (error: unknown) => {
      if (player.isDisposed() || !activeRef.current) return
      const failure = playbackFailure(error, msg('previews.video'))
      if (failure) setNotice(failure)
    })
  }, [])

  useLayoutEffect(() => {
    activeRef.current = active
    if (!active) {
      mayAutoplay.current = false
      playerRef.current?.pause()
      if (document.fullscreenElement && dialogRef.current!.contains(document.fullscreenElement)) {
        void document.exitFullscreen().catch((error: unknown) => report(msg('previews.couldNotExitFullscreen', { "value1": String(error) })))
      }
    }
  }, [active, report])

  useEffect(() => {
    const previousFocus = document.activeElement
    const element = document.createElement('video-js')
    element.className = 'video-js vjs-big-play-centered'
    hostRef.current!.append(element)
    const player = videojs(element, {
      controls: true, autoplay: false, preload: 'metadata', fluid: false, fill: true, language: i18n.language,
      playbackRates: [.5, 1, 1.5, 2], userActions: { hotkeys: false },
      controlBar: {
        progressControl: { seekBar: { playProgressBar: { children: [] } } },
      },
      sources: [{ src: result.url, type: previewMimeType('video', result.name) }],
    })
    playerRef.current = player
    player.on('play', () => {
      if (!activeRef.current) player.pause()
      else setNotice(null)
    })
    player.on('error', () => {
      const error = player.error()!
      report(tr('previews.videoLoadingOrDecodingFailed', { "message": error.message }))
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
  useEffect(() => { playerRef.current?.language(language) }, [language])
  useVideoShortcuts(playerRef, dialogRef, active, play, report)

  const close = () => { playerRef.current!.pause(); onClose() }
  return <div className="modal-backdrop preview-backdrop ap-overlay vp-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
    <section ref={dialogRef} className="ap-modal vp-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} inert={!active}>
      <MediaPreviewHeader title={result.name} titleId={titleId} icon={<Video size={20} />} showShortcuts={showShortcuts} shortcutsId={shortcutsId} onToggleShortcuts={() => setShowShortcuts(!showShortcuts)} onClose={close} />
      <div className="vp-content"><MediaShortcuts id={shortcutsId} open={showShortcuts} groups={shortcutGroups} />
        <div className="vp-player-container" ref={hostRef} />
        {notice && <p className="vp-notice" role={notice.error ? 'alert' : 'status'}>{renderMessage(notice.message)}</p>}
      </div>
    </section>
  </div>
}
