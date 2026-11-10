import { setLanguage } from '../../src/shared/i18n/messages'
import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { loadApplicationBootstrap } from '../../src/renderer/src/application-settings'
import type { ScriptExecutionDialogState } from '../../src/renderer/src/app-types'
import ScriptExecutionDialog from '../../src/renderer/src/components/ScriptExecutionDialog'
import PreviewDialog from '../../src/renderer/src/components/previews/PreviewDialog'
import LogPreviewDialog from '../../src/renderer/src/components/previews/LogPreviewDialog'
import { usePreview } from '../../src/renderer/src/hooks/usePreview'
import { createRemoteFilesApi } from '../../src/renderer/src/remote-files-api'
import { defaultFileTypeExtensions } from '../../src/shared/app-settings'
import type { PreviewResult } from '../../src/shared/types'
import '../../src/renderer/src/styles.css'

type FixturePreview = 'markdown' | 'image' | 'video' | 'text' | 'log' | 'pdf'
const fileNames: Record<FixturePreview, string> = {
  markdown: 'Markdown 只读预览.md',
  image: '图片预览.svg',
  video: '视频预览.webm',
  text: 'notes.txt',
  log: 'app.log',
  pdf: 'document.pdf',
}
const scriptExecution: ScriptExecutionDialogState = {
  request: { requestId: 'request', sessionId: 'test', scriptPath: '/test.sh', command: 'bash /test.sh' },
  name: 'test.sh',
  status: 'running',
  output: [{ stream: 'stdout', data: Array.from({ length: 120 }, (_, line) => `Output line ${line + 1}\n`).join('') }],
  message: null,
}

const content = `# 阅读预览

支持 **粗体**、~~删除线~~、表格、任务列表和离线代码高亮。

- [x] 只读预览
- [ ] 下一步部署

| 配置项 | 说明 |
|---|---|
| SSH | 会话绑定的资源读取 |

\`\`\`js
const greeting = '你好，Linux Nexus'
console.log(greeting)
\`\`\`

![示例图片](${location.origin}/__fixture_image.svg)

${Array.from({ length: 30 }, (_, i) => `## 章节 ${i}\n\n${'用于验证目录与阅读位置。'.repeat(12)}`).join('\n\n')}
`
function Fixture() {
  const [active, setActive] = useState(true)
  const [kind, setKind] = useState('markdown')
  const preview = usePreview({ sessionId: 'test', fileTypeExtensions: defaultFileTypeExtensions(), showToast: (_kind, message) => { throw new Error(message) } })
  useEffect(() => {
    Object.assign(window, { remoteFiles: {
      previewFile: async (_session: string, _path: string, type: Exclude<FixturePreview, 'log'>): Promise<PreviewResult> => {
        const name = fileNames[type]
        if (type === 'markdown') return { type, name, content, token: 'doc', resourceBaseUrl: 'remote-preview://doc/docs/readme.md' }
        if (type === 'text') return { type, name, content: 'Preview text', lineEnding: '\n', encoding: 'utf8', bom: false, version: { hash: 'text', identity: 'text' } }
        if (type === 'pdf') return { type, name, url: 'about:blank', token: 'pdf' }
        return { type, name, url: `remote-preview://${type}/fixture.${type === 'image' ? 'svg' : 'webm'}`, token: type }
      },
      readLogPreview: async () => ({ name: fileNames.log, content: 'Log preview', startOffset: 0, fileSize: 11, limitBytes: 1000, hasEarlier: false }),
      releasePreview: async () => {},
    }, fixtureOpen: async (next: FixturePreview | 'script') => {
      setKind(next)
      if (next === 'script') {
        preview.closePreview()
        return
      }
      const entry = { name: fileNames[next], path: '/fixture' }
      if (next === 'log') await preview.previewLogFile(entry)
      else await preview.previewFile(entry, next)
    } })
    void (window as any).fixtureOpen('markdown')
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (active && event.key === 'Escape' && !event.defaultPrevented) preview.closePreview()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [active, preview.closePreview])
  return <div className="app-shell"><main className="main-area"><header className="topbar">{kind} 预览验证</header>
    <div className="session-tabbar"><button id="switch-session" onClick={() => setActive((active) => !active)}>切换会话</button></div>
    <div className="session-content"><div className={'session-workspace-layer' + (active ? ' active' : '')}>
      <PreviewDialog active={active} previewDialog={preview.previewDialog} textReloading={false} textEncoding="utf8" onReopenText={() => {}} onConvertTextToUtf8={() => {}}
        textDraft={preview.textDraft} textDirty={preview.textDirty} textSaving={false} textSaveConfirmation={null} onClosePreview={preview.closePreview}
        onUpdateTextDraft={preview.updateTextDraft} onRequestTextSave={() => {}} onOpenExternalLink={() => {}} />
      <LogPreviewDialog logPreviewDialog={preview.logPreviewDialog} logViewportRef={preview.logViewportRef}
        onClosePreview={preview.closePreview} onLogPreviewScroll={preview.onLogPreviewScroll} />
      {kind === 'script' && <ScriptExecutionDialog active={active} execution={scriptExecution} onClose={() => setKind('')} onStop={() => {}} />}
    </div></div>
  </main></div>
}
setLanguage('zh-CN')
;(window as any).fixtureLanguage = setLanguage
void loadApplicationBootstrap(createRemoteFilesApi(window.remoteFilesTransport)).then(() => {
  createRoot(document.getElementById('root')!).render(<Fixture />)
})
