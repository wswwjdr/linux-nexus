import GithubSlugger from 'github-slugger'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import { toString } from 'mdast-util-to-string'
import { visit } from 'unist-util-visit'
import type { Root } from 'mdast'

export function collectHeadings(content: string, prefix: string) {
  const slugger = new GithubSlugger()
  const headings: { id: string; text: string; depth: number; offset: number }[] = []
  visit(unified().use(remarkParse).use(remarkGfm).parse(content), 'heading', (node) => {
    const text = toString(node)
    headings.push({ id: prefix + slugger.slug(text), text, depth: node.depth, offset: node.position!.start.offset! })
  })
  return headings
}

export function headingIds({ ids }: { ids: Map<number, string> }) {
  return (tree: Root) => {
    visit(tree, 'heading', (node) => {
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: ids.get(node.position!.start.offset!) } }
    })
  }
}
