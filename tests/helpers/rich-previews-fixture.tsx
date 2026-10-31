import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import PreviewDialog from '../../src/renderer/src/components/previews/PreviewDialog'
import { usePreview } from '../../src/renderer/src/hooks/usePreview'
import { defaultFileTypeExtensions } from '../../src/shared/app-settings'
import '../../src/renderer/src/styles.css'

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
      previewFile: async (_session: string, _path: string, type: string) => type === 'markdown'
        ? { type, name: 'Markdown 只读预览.md', content, token: 'doc', resourceBaseUrl: 'remote-preview://doc/docs/readme.md' }
        : { type, name: type === 'image' ? '图片预览.svg' : '视频预览.webm', url: `remote-preview://${type}/fixture.${type === 'image' ? 'svg' : 'webm'}`, token: type },
      releasePreview: async () => {},
    }, fixtureOpen: async (next: 'video' | 'image' | 'markdown') => {
      setKind(next)
      await preview.previewFile({ name: next === 'video' ? 'test.webm' : next === 'image' ? 'test.svg' : 'test.md', path: '/fixture' }, next)
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
        textDraft="" textDirty={false} textSaving={false} textSaveConfirmation={null} onClosePreview={preview.closePreview}
        onUpdateTextDraft={() => {}} onRequestTextSave={() => {}} onOpenExternalLink={() => {}} />
    </div></div>
  </main></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
