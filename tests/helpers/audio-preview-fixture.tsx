import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import AudioPreviewDialog from '../../src/renderer/src/components/previews/audio/AudioPreviewDialog'
import '../../src/renderer/src/styles.css'

function Fixture() {
  const [active, setActive] = useState(true)
  const [generation, setGeneration] = useState(1)
  const [open, setOpen] = useState(true)
  return <div className="app-shell"><main className="main-area">
    <header className="topbar">音频预览验证</header>
    <div className="session-tabbar">
      <button id="switch-session" onClick={() => setActive(!active)}>切换会话</button>
      <button id="reopen" onClick={() => { setGeneration(generation + 1); setOpen(true); setActive(true) }}>重新打开</button>
    </div>
    <div className="session-content">
      <div className={'session-workspace-layer' + (active ? ' active' : '')}>
        {open && <AudioPreviewDialog key={generation} active={active} onClose={() => setOpen(false)} result={{
          type: 'audio', name: '包含中文与空格的超长音频文件名-'.repeat(8) + '.wav',
          url: 'remote-preview://fixture/tone.wav', token: String(generation),
        }} />}
      </div>
    </div>
  </main></div>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
