import { type MessageValue, msg, renderMessage, tr } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Music2 } from 'lucide-react'
import type { PreviewResult } from '@shared/types'
import { MediaPreviewHeader, MediaShortcuts } from '../media/MediaPreviewHeader'
import { playbackFailure } from '../media/media-controls'
import { audioShortcutGroups, useAudioShortcuts } from './useAudioShortcuts'

interface AudioPreviewDialogProps {
  result: Extract<PreviewResult, { type: 'audio' }>
  active: boolean
  onClose: () => void
}

const mediaErrors: Record<number, MessageValue> = {
  1: msg('previews.audioLoadingWasInterruptedReopenThePreview'),
  2: msg('previews.audioCouldNotBeReadCheckTheServerConnectionAnd'),
  3: msg('previews.audioDecodingFailedTheFileMayBeDamagedOrUse'),
  4: msg('previews.thisAudioFormatOrCodecIsNotSupported'),
}

export default function AudioPreviewDialog({ result, active, onClose }: AudioPreviewDialogProps) {
  useLanguage()
  const audioRef = useRef<HTMLAudioElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const activeRef = useRef(active)
  const playbackGeneration = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [notice, setNotice] = useState<{ error: boolean; message: MessageValue } | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const titleId = useId()
  const shortcutsId = useId()

  const play = useCallback(() => {
    const audio = audioRef.current!
    const generation = playbackGeneration.current
    setNotice(null)
    void audio.play().then(() => {
      if (generation === playbackGeneration.current && !activeRef.current) audio.pause()
    }, (error: unknown) => {
      if (generation !== playbackGeneration.current || !activeRef.current) return
      const failure = playbackFailure(error, msg('previews.audio'))
      if (!failure) return
      setPlaying(false)
      setWaiting(false)
      setNotice(failure)
    })
  }, [])

  useLayoutEffect(() => {
    activeRef.current = active
    if (!active) {
      audioRef.current!.pause()
      setPlaying(false)
      setWaiting(false)
    }
  }, [active])

  useEffect(() => {
    const audio = audioRef.current!
    const previousFocus = document.activeElement
    // Restore the source after React StrictMode's development effect cleanup.
    audio.src = result.url
    if (activeRef.current) {
      dialogRef.current!.focus()
      play()
    }
    return () => {
      playbackGeneration.current++
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      if (activeRef.current && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [result.url, play])

  useAudioShortcuts(audioRef, dialogRef, active, play)

  const close = () => {
    audioRef.current!.pause()
    onClose()
  }

  return (
    <div className="modal-backdrop preview-backdrop ap-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close()
    }}>
      <section ref={dialogRef} className="ap-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} inert={!active}>
        <MediaPreviewHeader title={result.name} titleId={titleId} icon={<Music2 size={20} />} showShortcuts={showShortcuts} shortcutsId={shortcutsId} onToggleShortcuts={() => setShowShortcuts(!showShortcuts)} onClose={close} />
        <div className="ap-content">
          <MediaShortcuts id={shortcutsId} open={showShortcuts} groups={audioShortcutGroups} />
          <div className={'ap-body' + (playing && !waiting ? ' playing' : '')}>
            <div className="ap-visualizer" aria-hidden="true"><div className="ap-vinyl"><div className="ap-record-center"><Music2 size={16} /></div></div></div>
            <div className="ap-sound-waves" aria-hidden="true">{[1, 2, 3, 4, 5].map((bar) => <span key={bar} className={`ap-bar ap-bar-${bar}`} />)}</div>
            <audio ref={audioRef} controls src={result.url} aria-label={result.name}
              onPlay={() => {
                if (!activeRef.current) { audioRef.current!.pause(); return }
                setNotice(null)
                setPlaying(true)
              }}
              onPlaying={() => { setWaiting(false); setPlaying(activeRef.current) }}
              onPause={() => { setPlaying(false); setWaiting(false) }}
              onEnded={() => { setPlaying(false); setWaiting(false) }}
              onWaiting={() => setWaiting(true)}
              onCanPlay={() => setWaiting(false)}
              onError={() => {
                setPlaying(false)
                setWaiting(false)
                setNotice({ error: true, message: mediaErrors[audioRef.current!.error!.code] })
              }}
            >{tr('previews.yourBrowserDoesNotSupportAudioPlayback')}</audio>
            {waiting && !notice && <p className="ap-notice" role="status">{tr('previews.bufferingAudio')}</p>}
            {notice && <p className="ap-notice" role={notice.error ? 'alert' : 'status'}>{renderMessage(notice.message)}</p>}
          </div>
        </div>
      </section>
    </div>
  )
}
