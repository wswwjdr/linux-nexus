import { msg } from '@shared/i18n/messages'
import { useEffect, type RefObject } from 'react'
import { allowsMediaShortcut, applyMediaShortcut } from '../media/media-controls'

export const audioShortcutGroups = [
  { title: msg('previews.playbackControls'), items: [
    { keys: ['Space', 'K'], description: msg('previews.pausePlay') },
    { keys: ['M'], description: msg('previews.muteUnmute') },
    { keys: ['Esc'], description: msg('previews.exitPlayback') },
  ] },
  { title: msg('previews.seeking'), items: [
    { keys: ['←', '→'], description: msg('previews.backForward5s') },
    { keys: ['J', 'L'], description: msg('previews.backForward10s') },
    { keys: ['Home'], description: msg('previews.goToStart') },
    { keys: ['End'], description: msg('previews.goToEnd') },
  ] },
  { title: msg('previews.volumeAndSpeed'), items: [
    { keys: ['↑', '↓'], description: msg('previews.volumeUpDown') },
    { keys: ['<', '>'], description: msg('previews.slowerFasterBy025x') },
  ] },
]

export function useAudioShortcuts(
  audioRef: RefObject<HTMLAudioElement | null>,
  dialogRef: RefObject<HTMLElement | null>,
  active: boolean,
  play: () => void,
) {
  useEffect(() => {
    if (!active) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!allowsMediaShortcut(event, dialogRef.current!)) return
      if (!applyMediaShortcut(audioRef.current!, event.key, event.repeat, play)) return
      // Capture before Chromium's media controls to avoid handling a key twice.
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [active, audioRef, dialogRef, play])
}
