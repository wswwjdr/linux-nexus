import { useCallback, useEffect, useId, useMemo, useRef, useState, type ComponentPropsWithoutRef } from 'react'
import { BookOpen, List, X } from 'lucide-react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { PreviewResult } from '@shared/types'
import { markdownImageUrl } from '@shared/markdown-resources'
import { collectHeadings, headingIds } from './markdown-headings'

function CodeBlock({ children, ...props }: ComponentPropsWithoutRef<'pre'>) {
  const [notice, setNotice] = useState('')
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2000)
    return () => window.clearTimeout(timer)
  }, [notice])
  return <div className="md-code-block"><button className="md-copy-code" onClick={async (event) => {
    const text = event.currentTarget.parentElement!.querySelector('code')!.textContent!
    try { await navigator.clipboard.writeText(text); setNotice('已复制') }
    catch { setNotice('复制失败，请手动选择代码') }
  }}>复制代码</button><pre {...props}>{children}</pre>{notice && <span role="status" className="md-copy-notice">{notice}</span>}</div>
}

function MarkdownImage({ src, alt }: { src: string | null; alt?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <span className="md-image-error" role="img" aria-label={alt || '图片'}>图片无法加载{alt && `：${alt}`}</span>
  return <img src={src} alt={alt || ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

export default function MarkdownPreviewDialog({ result, active, onClose, onOpenExternalLink }: {
  result: Extract<PreviewResult, { type: 'markdown' }>; active: boolean; onClose: () => void; onOpenExternalLink: (url: string) => void
}) {
  const titleId = useId()
  const prefix = useId() + '-heading-'
  const catalogId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const headings = useMemo(() => collectHeadings(result.content, prefix), [result.content, prefix])
  const ids = useMemo(() => new Map(headings.map(({ id, offset }) => [offset, id])), [headings])
  const [currentHeading, setCurrentHeading] = useState(headings[0]?.id ?? '')
  useEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current!
    if (active) dialog.focus()
    return () => { if (dialog.contains(document.activeElement) && previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    if (!active) return
    const viewport = viewportRef.current!
    const update = () => {
      const top = viewport.getBoundingClientRect().top + 36
      let current = headings[0]?.id ?? ''
      for (const heading of headings) {
        if (document.getElementById(heading.id)!.getBoundingClientRect().top > top) break
        current = heading.id
      }
      setCurrentHeading(current)
    }
    viewport.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(viewport); update()
    return () => { viewport.removeEventListener('scroll', update); observer.disconnect() }
  }, [active, headings])
  const jump = useCallback((id: string) => {
    const viewport = viewportRef.current!
    const target = document.getElementById(id)
    if (!target || !viewport.contains(target)) return
    viewport.scrollTop += target.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 20
    setCurrentHeading(id)
  }, [])
  const body = useMemo(() => (
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm, [headingIds, { ids }]]} rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      urlTransform={(url, key) => key === 'src' ? markdownImageUrl(url, result.resourceBaseUrl) ?? '' : defaultUrlTransform(url)}
      components={{
        pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
        img: ({ src, alt }) => <MarkdownImage key={typeof src === 'string' ? src : ''} src={typeof src === 'string' ? src : null} alt={alt} />,
        a: ({ href, children }) => {
          if (href?.startsWith('#')) {
            let fragment: string
            try { fragment = decodeURIComponent(href.slice(1)) } catch { return <span>{children}</span> }
            return <a href={href} onClick={(event) => { event.preventDefault(); jump(prefix + fragment) }}>{children}</a>
          }
          let url: URL
          try { url = new URL(href!) } catch { return <span className="md-disabled-link">{children}</span> }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return <span className="md-disabled-link">{children}</span>
          return <a href={url.href} rel="noreferrer" onClick={(event) => { event.preventDefault(); onOpenExternalLink(url.href) }}>{children}</a>
        },
        table: ({ node: _node, ...props }) => <div className="md-table-scroll"><table {...props} /></div>,
      }}
    >{result.content}</ReactMarkdown>
  ), [result.content, result.resourceBaseUrl, ids, prefix, jump, onOpenExternalLink])
  return <div className="modal-backdrop preview-backdrop ap-overlay md-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="ap-modal md-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} inert={!active}>
      <header className="ap-header"><div className="ap-title-area"><span className="ap-title-icon"><BookOpen size={20} /></span><h2 id={titleId} title={result.name}>{result.name}</h2></div>
        <div className="ap-header-actions"><button className={'ap-icon-button' + (catalogOpen ? ' active' : '')} aria-label="目录" title="目录" aria-expanded={catalogOpen} aria-controls={catalogId} disabled={headings.length === 0} onClick={() => setCatalogOpen(!catalogOpen)}><List size={18} /></button>
          <button className="ap-icon-button ap-close" title="关闭预览" aria-label="关闭预览" onClick={onClose}><X size={18} /></button></div>
      </header>
      <div className={'md-layout' + (catalogOpen ? ' catalog-open' : '')}>
        <nav className="md-catalog" id={catalogId} aria-label="文档目录" hidden={!catalogOpen}>
          {headings.map((heading) => <button key={heading.id} style={{ paddingLeft: 12 + (heading.depth - 1) * 12 }} aria-current={currentHeading === heading.id ? 'location' : undefined} onClick={() => jump(heading.id)}>{heading.text || '无标题'}</button>)}
        </nav>
        <div className="md-viewport" ref={viewportRef}><article className="md-article">
          {body}
        </article></div>
      </div>
    </section>
  </div>
}
