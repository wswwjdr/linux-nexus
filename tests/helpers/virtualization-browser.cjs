const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
app.setPath('userData', require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'nexus-browser-')))
app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const server = await createServer({ configFile: false, cacheDir: require('node:path').join(app.getPath('userData'), 'vite-cache'), resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } }, plugins: [react(), {
    name: 'virtual-test', configureServer(server) {
      server.middlewares.use('/__virtual_test', async (_req, response) => {
        const html = await server.transformIndexHtml('/__virtual_test', `<html><body><div id="root"></div><script type="module">
import { setLanguage } from '/src/shared/i18n/messages.ts'; setLanguage('zh-CN');
          import React, { useRef, useState } from 'react'; import { createRoot } from 'react-dom/client';
          import Collection from '/src/renderer/src/features/files/FileEntryCollection.tsx';
          import '/src/renderer/src/styles/foundation.css'; import '/src/renderer/src/styles/theme.css'; import '/src/renderer/src/styles/workspace.css';
          const entries = Array.from({ length: 10000 }, (_, i) => ({ path: '/file-' + i, name: 'file-' + i, type: 'file', size: 100, modifiedAt: null, permissions: '644' }));
          function Fixture() { const ref = useRef(null); const [view, setView] = useState('details'); const [highlight, setHighlight] = useState(null); window.changeView = setView; window.highlightLast = () => setHighlight('/file-9999');
            const actions = Object.fromEntries(['onToggleSort','onEntryClick','onEntryContextMenu','onEntryDragStart','onEntryDragOver','onEntryDragLeave','onEntryDrop','onOpenEntry','onTileMouseEnter','onTileMouseLeave','onTileBlur'].map(key => [key, () => {}]));
            return React.createElement('div', { ref, id: 'viewport', style: { height: 400, overflow: 'auto' } }, React.createElement(Collection, { ...actions, viewportRef: ref, sortedEntries: entries, selectedPaths: [], highlightedPath: highlight, sort: { column: 'name', direction: 'ascending' }, viewMode: view, dropTargetPath: null, hoveredPath: null, operationActive: false, hoverCardRef: { current: null } })); }
          createRoot(document.getElementById('root')).render(React.createElement(Fixture));
        </script></body></html>`)
        response.setHeader('Content-Type', 'text/html'); response.end(html)
      })
    }
  }], server: { host: '127.0.0.1', port: 0, watch: null } })
  const window = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
  try {
    await server.listen(); await window.loadURL(server.resolvedUrls.local[0] + '__virtual_test')
    while (!await window.webContents.executeJavaScript('Boolean(document.querySelector("[data-entry-path]"))')) await new Promise(resolve => setTimeout(resolve, 50))
    const metrics = await window.webContents.executeJavaScript(`(async () => {
      const tick = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const viewport = document.getElementById('viewport'), metrics = [];
      for (const view of ['details', 'icons']) {
        window.changeView(view); viewport.scrollTop = 0; await tick();
        const count = document.querySelectorAll('[data-entry-path]').length;
        if (count >= 200 || count < 1) throw new Error('DOM not bounded: ' + count);
        window.highlightLast(); await tick(); await tick();
        if (!document.querySelector('[data-entry-path="/file-9999"]')) { viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll')); await tick(); }
        const last = document.querySelector('[data-entry-path="/file-9999"]');
        if (!last) throw new Error('last item missing in ' + view);
        const bounds = last.getBoundingClientRect(), parent = viewport.getBoundingClientRect();
        if (bounds.top < parent.top - 1 || bounds.top > parent.bottom) throw new Error('last item offscreen in ' + view);
        metrics.push({ view, rendered: count, scrollHeight: viewport.scrollHeight });
      }
      return metrics;
    })()`)
    mkdirSync(resolve('data'), { recursive: true })
    writeFileSync(resolve('data/audit-virtualization.png'), (await window.webContents.capturePage()).toPNG())
    console.log('virtual scrolling browser checks passed ' + JSON.stringify(metrics))
  } finally { window.destroy(); await server.close() }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
