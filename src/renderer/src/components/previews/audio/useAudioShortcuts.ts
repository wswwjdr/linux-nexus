import { useEffect, type RefObject } from 'react'
import { allowsMediaShortcut, applyMediaShortcut } from '../media/media-controls'

export const audioShortcutGroups = [
  { title: '常用控制', items: [
    { keys: ['Space', 'K'], description: '暂停 / 播放' },
    { keys: ['M'], description: '静音 / 取消静音' },
    { keys: ['Esc'], description: '退出播放' },
  ] },
  { title: '进度调整', items: [
    { keys: ['←', '→'], description: '后退 / 前进 5s' },
    { keys: ['J', 'L'], description: '后退 / 前进 10s' },
    { keys: ['Home'], description: '跳至开头' },
    { keys: ['End'], description: '跳至结尾' },
  ] },
  { title: '音量与速度', items: [
    { keys: ['↑', '↓'], description: '音量增 / 减' },
    { keys: ['<', '>'], description: '减速 / 加速 0.25x' },
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
