import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { msg, renderMessage, tr, type MessageValue } from '@shared/i18n/messages'
import { useLanguage } from '@/i18n'

/** Presents a rendered code block with an accessible copy action. */
export function MarkdownCodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  useLanguage()
  const code = useRef<HTMLPreElement>(null)
  const [notice, setNotice] = useState<MessageValue>('')
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return <div className="md-code-block">
    <button type="button" className="md-copy-code" onClick={async () => {
      try {
        await navigator.clipboard.writeText(code.current?.textContent ?? '')
        setNotice(msg('previews.copied'))
      } catch { setNotice(msg('previews.copyFailedSelectTheCodeManually')) }
    }}>{tr('previews.copyCode')}</button>
    <pre ref={code} {...props} />
    {notice && <span role="status" className="md-copy-notice">{renderMessage(notice)}</span>}
  </div>
}

/** Keeps wide Markdown tables within their own scrollable region. */
export function MarkdownTable(props: ComponentPropsWithoutRef<'table'>) {
  return <div className="md-table-scroll"><table {...props} /></div>
}

/** Returns a link safe to pass to the existing external link handler. */
export function markdownExternalUrl(href?: string): string | undefined {
  if (!href) return
  try {
    const url = new URL(href)
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href
  } catch { return }
}
