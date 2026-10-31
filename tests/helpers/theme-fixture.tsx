import React, { createRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Terminal } from '@xterm/xterm'
import { House, Settings, Search, Terminal as TerminalIcon, Upload, Plus } from 'lucide-react'
import ServerList from '../../src/renderer/src/components/ServerList'
import FileEntryCollection from '../../src/renderer/src/features/files/FileEntryCollection'
import FileContextMenu from '../../src/renderer/src/features/files/FileContextMenu'
import TransferTray from '../../src/renderer/src/components/TransferTray'
import GlobalToast from '../../src/renderer/src/GlobalToast'
import TerminalPanel from '../../src/renderer/src/components/TerminalPanel'
import PerformanceMonitor from '../../src/renderer/src/components/PerformanceMonitor'
import type { PerformanceSnapshot, PerformanceMonitorState } from '../../src/shared/types'
import { DEFAULT_APP_SETTINGS } from '../../src/shared/app-settings'
import '../../src/renderer/src/styles.css'

const noop = () => {}
const profile = { id: 'server', name: '生产服务器 · Nexus', host: '192.0.2.10', port: 22, username: 'deploy', pinned: true }
const entries = ['应用配置', 'deployment', 'app.log', 'README.md', 'deploy.sh', 'backup.tar.gz'].map((name, i) => ({
  name, path: '/srv/' + name, type: i < 2 ? 'directory' as const : 'file' as const,
  size: i < 2 ? 4096 : 2048 * (i + 1), modifiedAt: '2026-10-31T08:30:00Z', permissions: i < 2 ? 'drwxr-xr-x' : '-rw-r--r--',
}))
const viewportRef = createRef<HTMLDivElement>()
const hoverCardRef = createRef<HTMLDivElement>()
const anchorRef = createRef<HTMLElement>()
const snapshot: PerformanceSnapshot = {
  sampledAt: new Date().toISOString(), cpuPercent: 24, memoryPercent: 46, diskPercent: 61,
  memoryUsedBytes: 4 * 1024 ** 3, memoryTotalBytes: 8 * 1024 ** 3,
  diskUsedBytes: 61 * 1024 ** 3, diskTotalBytes: 100 * 1024 ** 3,
  loadAverage: [.35, .42, .38], uptimeSeconds: 123456, cpuCores: 8,
}
const monitorState: PerformanceMonitorState = {
  sessionId: 'files', version: 1, status: 'ready', snapshot, message: null,
  history: [Array.from({ length: 30 }, (_, i) => ({ ...snapshot,
    sampledAt: new Date(Date.now() - (29 - i) * 30_000).toISOString(),
    cpuPercent: 24 + Math.sin(i) * 12, memoryPercent: 46 + Math.sin(i / 3) * 5, diskPercent: 61,
  }))],
}
const fixtureWindow = window as any
const terminalOpen = Terminal.prototype.open
Terminal.prototype.open = function (host) {
  fixtureWindow.terminal = this
  return terminalOpen.call(this, host)
}
fixtureWindow.outputSubscriptions = 0
fixtureWindow.terminalWrites = []
fixtureWindow.remoteFiles = {
  writeTerminal: async (_session: string, data: string) => fixtureWindow.terminalWrites.push(data),
  resizeTerminal: async () => {},
  onTerminalOutput: (listener: unknown) => {
    fixtureWindow.outputSubscriptions++
    fixtureWindow.emitOutput = listener
    return () => { fixtureWindow.outputSubscriptions-- }
  },
}

function Files({ grid = false }: { grid?: boolean }) {
  return <div className="file-content-wrap" ref={viewportRef} tabIndex={0}>
    <FileEntryCollection viewportRef={viewportRef} hoverCardRef={hoverCardRef} sortedEntries={entries}
      selectedPaths={['/srv/app.log']} highlightedPath={null} sort={{ column: 'name', direction: 'ascending' }}
      viewMode={grid ? 'icons' : 'details'} dropTargetPath={null} hoveredPath={null} operationActive={false}
      onToggleSort={noop} onEntryClick={noop} onEntryContextMenu={noop} onEntryDragStart={noop}
      onEntryDragOver={noop} onEntryDragLeave={noop} onEntryDrop={noop} onOpenDirectory={noop}
      onTileMouseEnter={noop} onTileMouseLeave={noop} onTileBlur={noop} />
  </div>
}

function Fixture() {
  const [scene, setScene] = useState('home')
  fixtureWindow.showScene = setScene
  return <div className="app-shell"><main className="main-area">
    <header className="topbar"><div className="topbar-left">
      <button className="icon-button toolbar-button" aria-label="首页"><House size={16} /></button>
      <button className="icon-button toolbar-button" aria-label="设置"><Settings size={16} /></button>
      <span className="topbar-separator" /><span className="connected-host">deploy@192.0.2.10</span>
    </div><div className="topbar-actions">
      {scene === 'performance-ready' && <PerformanceMonitor state={monitorState} thresholds={DEFAULT_APP_SETTINGS.performanceThresholds}
        open onOpenChange={noop} onRefresh={noop} />}
      <button className="icon-button toolbar-button" aria-label="搜索"><Search size={16} /></button>
      <button className="icon-button toolbar-button" aria-label="终端"><TerminalIcon size={16} /></button>
      <button className="text-button"><Upload size={15} /> 上传文件</button>
    </div></header>
    <div className="session-tabbar"><div className="session-tab active"><button className="session-tab-select">生产服务器 <small>SFTP</small><span className="session-tab-state-dot connected" /></button></div>
      <div className="session-tab"><button className="session-tab-select">部署终端 <small>SSH</small></button></div>
      <button className="icon-button session-add-button" aria-label="新建"><Plus size={14} /></button></div>
    <div className="session-content">
      {scene === 'home' ? <ServerList profiles={[{ profile, connectedAt: 1793435400000 }, { profile: { ...profile, id: 'staging', name: '测试服务器', host: '192.0.2.20', pinned: false } }]}
        connectionPending={false} onAdd={noop} onConnect={noop} onEdit={noop} onSetPinned={noop} onDelete={noop} />
        : scene === 'terminal' ? <TerminalPanel sessionId="ssh" active connected onError={message => { throw new Error(message) }} />
        : <><div className="pathbar"><span className="breadcrumbs">/ srv / <strong>nexus</strong></span>
          <div className="pathbar-tools"><button className="secondary-button" id="enabled">操作</button><button className="secondary-button" disabled id="disabled">不可用</button></div></div>
          <Files grid={scene === 'grid'} /></>}
      {scene === 'menu' && <FileContextMenu context={{ kind: 'single-entry', entry: entries[2], canPaste: false }}
        fileTypeExtensions={DEFAULT_APP_SETTINGS.fileTypeExtensions} position={{ x: 320, y: 170 }} anchorRef={anchorRef} onAction={noop} onClose={noop} />}
      {scene === 'feedback' && <><TransferTray sessionId="files" transfers={{ upload: {
        sessionId: 'files', profileName: profile.name, name: 'release.tar.gz', direction: 'upload', transferred: 6291456, total: 10485760,
        completedFiles: 0, failedFiles: 0, activeFiles: [], failures: [], state: 'running',
      } }} onCancel={noop} onDismiss={noop} />
        <GlobalToast notices={[{ id: 1, kind: 'info', message: '正在将发布包上传到 /srv/nexus' }, { id: 2, kind: 'error', message: '测试目录访问失败：权限不足' }]} onDismiss={noop} /></>}
    </div>
  </main></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
