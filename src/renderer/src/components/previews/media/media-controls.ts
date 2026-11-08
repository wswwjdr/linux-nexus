import { type MessageValue, msg } from '@shared/i18n/messages'
export function seekMedia(media: HTMLMediaElement, delta: number) {
  if (Number.isFinite(media.duration)) media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + delta))
}

export function applyMediaShortcut(media: HTMLMediaElement, key: string, repeat: boolean, play: () => void): boolean {
  switch (key.toLowerCase()) {
    case ' ': case 'k': if (!repeat) { if (media.paused) play(); else media.pause() }; break
    case 'arrowleft': seekMedia(media, -5); break
    case 'arrowright': seekMedia(media, 5); break
    case 'j': seekMedia(media, -10); break
    case 'l': seekMedia(media, 10); break
    case 'arrowup': media.volume = Math.min(1, media.volume + .1); break
    case 'arrowdown': media.volume = Math.max(0, media.volume - .1); break
    case 'm': if (!repeat) media.muted = !media.muted; break
    case 'home': media.currentTime = 0; break
    case 'end': if (Number.isFinite(media.duration)) media.currentTime = media.duration; break
    case '<': media.playbackRate = Math.max(.25, media.playbackRate - .25); break
    case '>': media.playbackRate = Math.min(4, media.playbackRate + .25); break
    default: return false
  }
  return true
}

export function allowsMediaShortcut(event: KeyboardEvent, dialog: HTMLElement): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return false
  const target = event.target
  if (!(target instanceof HTMLElement)) return true
  if (target.closest('input, textarea, select, [role="menu"], [contenteditable]:not([contenteditable="false"])')) return false
  if (target !== document.body && !dialog.contains(target)) return false
  return !(event.key === ' ' && target.closest('button, a, summary, [role="button"]'))
}

export function playbackFailure(error: unknown, label: MessageValue): { error: boolean; message: MessageValue } | null {
  if (error instanceof DOMException && error.name === 'AbortError') return null
  const blocked = error instanceof DOMException && error.name === 'NotAllowedError'
  return { error: !blocked, message: blocked ? msg('previews.autoplayWasBlockedClickPlayOrPressSpaceToStart')
    : msg('previews.playbackFailed', { "label": label, "value2": error instanceof Error ? error.message : String(error) }) }
}
