import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { MarkdownCodeBlock, MarkdownTable, markdownExternalUrl } from '@/components/previews/markdown/MarkdownBlocks'

/** Renders untrusted assistant Markdown without fetching images or executing content. */
export const AssistantMarkdown = memo(function AssistantMarkdown({ text, onOpenExternalLink }: {
  text: string
  onOpenExternalLink: (url: string) => void
}) {
  return <div className="md-article assistant-markdown">
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
      components={{
        pre: ({ node: _node, ...props }) => <MarkdownCodeBlock {...props} />,
        table: ({ node: _node, ...props }) => <MarkdownTable {...props} />,
        img: ({ alt }) => alt ? <span>{alt}</span> : null,
        a: ({ href, children }) => {
          const url = markdownExternalUrl(href)
          return url ? <a href={url} rel="noreferrer" onClick={(event) => {
            event.preventDefault()
            onOpenExternalLink(url)
          }}>{children}</a> : <span>{children}</span>
        },
      }}>{text}</ReactMarkdown>
  </div>
})
