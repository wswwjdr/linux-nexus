import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownPreviewPanelProps {
  content: string
  onOpenExternalLink: (url: string) => void
}

function httpUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export default function MarkdownPreviewPanel({ content, onOpenExternalLink }: MarkdownPreviewPanelProps) {
  return (
    <div className="preview-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => {
            const url = httpUrl(href)
            if (!url) return <span className="preview-markdown-link-disabled">{children}</span>
            return <a href={url} rel="noreferrer" onClick={(event) => {
              event.preventDefault()
              onOpenExternalLink(url)
            }}>{children}</a>
          },
          img: ({ alt }) => <span className="preview-markdown-image">{alt ? `[图片：${alt}]` : '[图片]'}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
