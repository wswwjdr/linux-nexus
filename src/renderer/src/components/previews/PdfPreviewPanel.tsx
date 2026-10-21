interface PdfPreviewPanelProps {
  name: string
  url: string
}

export default function PdfPreviewPanel({ name, url }: PdfPreviewPanelProps) {
  return <iframe className="preview-pdf" title={name} src={url} />
}
