import { type MessageValue, msg } from '@shared/i18n/messages'
import { useEffect, type RefObject } from 'react'
import type Player from 'video.js/dist/types/player'
import { allowsMediaShortcut, applyMediaShortcut, seekMedia } from '../media/media-controls'

export function useVideoShortcuts(playerRef: RefObject<Player | null>, dialogRef: RefObject<HTMLElement | null>, active: boolean, play: () => void, report: (message: MessageValue) => void) {
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let holding = false
    let previousRate = 1
    let exitedFullscreenAt = -Infinity
    const media = () => playerRef.current?.el()?.querySelector('video')
    const reset = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (holding && media()) media()!.playbackRate = previousRate
      holding = false
    }
    const fullscreenChanged = () => { if (!document.fullscreenElement) exitedFullscreenAt = performance.now() }
    const down = (event: KeyboardEvent) => {
      const player = playerRef.current
      const video = media()
      if (!player || !video) return
      if (event.key === 'Escape' && (player.isFullscreen() || document.fullscreenElement || performance.now() - exitedFullscreenAt < 150)) {
        event.preventDefault(); event.stopImmediatePropagation()
        if (player.isFullscreen()) Promise.resolve(player.exitFullscreen()).catch((error: unknown) => report(String(error)))
        return
      }
      if (!allowsMediaShortcut(event, dialogRef.current!)) return
      const key = event.key.toLowerCase()
      if (key === 'arrowright') {
        if (!event.repeat && !timer && !holding) timer = setTimeout(() => {
          timer = null; holding = true; previousRate = video.playbackRate; video.playbackRate = 2
        }, 500)
      } else if (key === 'f') {
        if (!event.repeat) Promise.resolve(player.isFullscreen() ? player.exitFullscreen() : player.requestFullscreen()).catch((error: unknown) => report(msg('previews.fullscreenOperationFailed', { "value1": String(error) })))
      } else if (!applyMediaShortcut(video, event.key, event.repeat, play)) return
      event.preventDefault(); event.stopPropagation()
    }
    const up = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowRight' || (!timer && !holding)) return
      if (timer && media()) seekMedia(media()!, 5)
      reset()
      event.preventDefault(); event.stopPropagation()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', reset)
    document.addEventListener('fullscreenchange', fullscreenChanged)
    return () => {
      reset()
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', reset)
      document.removeEventListener('fullscreenchange', fullscreenChanged)
    }
  }, [active, playerRef, dialogRef, play, report])
}
