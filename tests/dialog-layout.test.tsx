import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import React, { act, createRef, type ReactElement } from 'react'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { JSDOM } from 'jsdom'
import PreviewDialog from '../src/renderer/src/components/previews/PreviewDialog'
import LogPreviewDialog from '../src/renderer/src/components/previews/LogPreviewDialog'
import ScriptExecutionDialog from '../src/renderer/src/components/ScriptExecutionDialog'
import ScriptSessionDialogs from '../src/renderer/src/features/files/ScriptSessionDialogs'
import SearchDialog from '../src/renderer/src/features/search/SearchDialog'
import ShortcutGuideDialog from '../src/renderer/src/components/ShortcutGuideDialog'
import SessionChooser from '../src/renderer/src/components/SessionChooser'
import ConfirmationDialog from '../src/renderer/src/components/ConfirmationDialog'
import UploadConfirmDialog from '../src/renderer/src/components/UploadConfirmDialog'
import RemoteEntryRenameDialog from '../src/renderer/src/components/RemoteEntryRenameDialog'
import { RemoteArchiveDialogs } from '../src/renderer/src/components/RemoteArchiveDialogs'
import PerformanceMonitor from '../src/renderer/src/components/PerformanceMonitor'
import { ProfileDialogs } from '../src/renderer/src/components/dialogs/ProfileDialogs'
import { DirectoryDialogs } from '../src/renderer/src/components/dialogs/DirectoryDialogs'
import { SettingsDialog } from '../src/renderer/src/components/dialogs/SettingsDialog'
import { SecurityDialogs } from '../src/renderer/src/components/dialogs/SecurityDialogs'
import { DEFAULT_APP_SETTINGS } from '../src/shared/app-settings'
import { performanceThresholdsToForm } from '../src/renderer/src/app-types'
import type { PreviewResult } from '../src/shared/types'

const noop = () => {}
const longText = Array.from({ length: 200 }, (_, index) => `第 ${index + 1} 行：用于检查滚动区域的文件内容。`).join('\n')
const profile = { id: 'server', name: '测试服务器', host: '192.0.2.1', port: 22, username: 'root', pinned: false }
const fixture = (name: string, element: ReactElement) => ({ name, html: renderToStaticMarkup(element) })

test('dialogs fit window and session bounds with reachable actions at small window sizes', { timeout: 120_000 }, async () => {
  const dom = new JSDOM('', { url: 'http://localhost' })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const preview = (result: PreviewResult) => fixture(result.type, <PreviewDialog
    previewDialog={{ kind: 'ready', result }} textDraft={longText} textDirty textSaving={false} textSaveConfirmation={null}
    imageZoom={1} imagePreviewSize={{ width: 1600, height: 1200 }} imageViewportRef={createRef()} previewImageRef={createRef()}
    onClosePreview={noop} onUpdateTextDraft={noop} onRequestTextSave={noop} onOpenExternalLink={noop} onPreviewImageLoad={noop} onZoomPreviewImage={noop}
  />)
  const fixtures = [
    preview({ type: 'text', name: '说明文档.txt', content: longText, lineEnding: '\n' }),
    preview({ type: 'markdown', name: '说明文档.md', content: longText }),
    preview({ type: 'pdf', name: '说明文档.pdf', url: 'about:blank', token: 'test' }),
    preview({ type: 'image', name: '图片.png', url: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"/>', token: 'test' }),
    preview({ type: 'video', name: '视频.mp4', url: 'about:blank', token: 'test' }),
    preview({ type: 'audio', name: '音频.mp3', url: 'about:blank', token: 'test' }),
    fixture('log', <LogPreviewDialog logPreviewDialog={{ kind: 'ready', name: 'app.log', sessionId: 'session', path: '/app.log', content: longText, startOffset: 0, fileSize: 10000, limitBytes: 10000, hasEarlier: false, loadingEarlier: false }} logViewportRef={createRef()} onClosePreview={noop} onLogPreviewScroll={noop} />),
    fixture('script output', <ScriptExecutionDialog active execution={{ request: { requestId: 'request', sessionId: 'session', scriptPath: '/test.sh', command: 'bash /test.sh' }, name: 'test.sh', status: 'running', output: [{ stream: 'stdout', data: longText }], message: null }} onClose={noop} onStop={noop} />),
    fixture('script command', <ScriptSessionDialogs sessionId="session" active commandDialog={{ name: 'test.sh', command: 'bash /test.sh' }} executionDialog={null} onCloseCommand={noop} onUpdateCommand={noop} onSubmitCommand={noop} onCloseExecution={noop} onStopExecution={noop} />),
    fixture('shortcuts', <ShortcutGuideDialog onClose={noop} />),
    fixture('session chooser', <SessionChooser profiles={[profile]} onClose={noop} onCreate={noop} />),
    fixture('directory', <DirectoryDialogs createDirectoryDialog={{ name: '' }} creatingDirectory={false} onCloseCreateDirectory={noop} onUpdateCreateDirectoryName={noop} onSubmitCreateDirectory={noop} />),
    fixture('profile', <ProfileDialogs profileDialog={{ mode: 'create', form: { id: '', name: '', host: '', port: '22', username: '', password: '' } }} profileDeleteDialog={null} profileDeleteError={null} profileDeleting={false} onCloseProfile={noop} onCloseProfileDelete={noop} onConfirmProfileDelete={noop} onUpdateProfile={noop} onSubmitProfile={noop} />),
    fixture('fingerprint', <SecurityDialogs pendingHostKey={null} pendingAliasHostKey={{ profile, fingerprint: 'SHA256:' + 'a'.repeat(64), previousFingerprint: 'SHA256:' + 'b'.repeat(64) }} aliasOverwriteConfirmation={null} aliasDeleteConfirmation={null} aliasOperationBusy={false} onTrustHostKey={noop} onDismissHostKey={noop} onTrustAliasHostKey={noop} onDismissAliasHostKey={noop} onConfirmAliasOverwrite={noop} onCancelAliasOverwrite={noop} onConfirmAliasDelete={noop} onCancelAliasDelete={noop} />),
    fixture('settings', <SettingsDialog profiles={[profile]} aliasSnapshot={null} aliasProfileId="server" aliasOperationBusy={false} aliasName="" aliasCommand="" settingsForm={{
      theme: 'light', defaultView: 'details', fileTypeExtensions: DEFAULT_APP_SETTINGS.fileTypeExtensions,
      textMiB: '5', pdfMiB: '100', imageMiB: '100', audioMiB: '100', videoMiB: '100', transferFileConcurrency: '4', performanceSampleIntervalSeconds: '3',
      performanceThresholds: performanceThresholdsToForm(DEFAULT_APP_SETTINGS.performanceThresholds), startupProfileId: '', startupKind: 'files',
    }} onCloseSettings={noop} onUpdateSettings={noop} onAddFileTypeExtension={noop} onRemoveFileTypeExtension={noop} onResetFileTypeExtensions={noop} onUpdateDefaultView={noop} onUpdateTheme={noop} onUpdateStartupProfile={noop} onUpdateStartupKind={noop} onSelectAliasProfile={noop} onUpdateAliasName={noop} onUpdateAliasCommand={noop} onSyncAliases={noop} onAddAlias={noop} onRequestAliasDelete={noop} />),
    fixture('search', <SearchDialog sessionId="session" profileId="server" currentPath="/" visible previewOpen={false} fileTypeExtensions={DEFAULT_APP_SETTINGS.fileTypeExtensions} onClose={noop} onMenuAction={noop} />),
    fixture('rename', <RemoteEntryRenameDialog state={{ sessionId: 'session', profileId: 'server', entry: { name: 'test.txt', path: '/test.txt', type: 'file', size: 0, modifiedAt: null, permissions: '' } }} onSubmit={async () => {}} onClose={noop} />),
    fixture('performance', <PerformanceMonitor state={{ sessionId: 'session', version: 1, status: 'error', snapshot: null, history: [], message: longText }} thresholds={DEFAULT_APP_SETTINGS.performanceThresholds} open onOpenChange={noop} onRefresh={noop} />),
  ]
  // Portal dialogs must render into a document before their markup can be tested.
  const { createRoot } = await import('react-dom/client')
  Object.defineProperty(window, 'remoteFiles', { value: { listDirectory: async () => Array.from({ length: 30 }, (_, index) => ({ name: `目录-${index}`, path: `/目录-${index}`, type: 'directory', size: 0, modifiedAt: null, permissions: '' })) } })
  for (const [name, element] of [
    ['confirmation', <ConfirmationDialog title="确认删除文件？" description="所选文件将被删除。" details={Array.from({ length: 20 }, (_, index) => ({ label: `文件 ${index}`, value: `/目录/文件-${index}.txt` }))} tone="danger" confirmLabel="删除" onConfirm={noop} onCancel={noop} />],
    ['upload', <UploadConfirmDialog selection={{ selectionId: 'selection', requestId: 'request', sessionId: 'session', profileId: 'server', remoteDirectory: '/', remoteRoot: '/', name: 'upload', strategy: 'confirm', items: [], failures: [], conflicts: Array.from({ length: 30 }, (_, index) => `/文件-${index}.txt`) }} onConfirm={noop} onCancel={noop} />],
    ['archive destination', <RemoteArchiveDialogs destination={{ sessionId: 'session', entry: { name: 'archive.tar.gz', path: '/archive.tar.gz' }, directory: '/', strategy: 'force' }} onCloseDestination={noop} onChooseDestination={noop} onCreateDirectory={async () => {}} />],
  ] as const) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(element) })
      fixtures.push({ name, html: document.body.innerHTML })
    } finally {
      act(() => root.unmount())
      host.remove()
    }
  }
  const css = (await Promise.all(['foundation', 'workspace', 'dialogs', 'search', 'remote-operations', 'responsive', 'theme'].map((name) => readFile(new URL(`../src/renderer/src/styles/${name}.css`, import.meta.url), 'utf8')))).join('\n')
  const directory = await mkdtemp(join(tmpdir(), 'linux-nexus-dialog-layout-'))
  try {
    const input = join(directory, 'fixtures.json')
    await writeFile(input, JSON.stringify({ css, fixtures }))
    const { default: electron } = await import('electron')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(electron as unknown as string, [fileURLToPath(new URL('./helpers/dialog-layout.cjs', import.meta.url)), input], { env, windowsHide: true, timeout: 30_000 })
      let output = ''
      child.stdout.on('data', (chunk) => { output += chunk })
      child.stderr.on('data', (chunk) => { output += chunk })
      child.on('error', reject)
      child.on('exit', (code) => resolve({ code, output }))
    })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /"checks":160,"failures":\[\]/)
  } finally {
    await rm(directory, { recursive: true, force: true })
    dom.window.close()
  }
})
