const { app, BrowserWindow, nativeTheme } = require('electron')
const { resolve } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')
const profilePath = resolve('data/content-search-browser-profile')
mkdirSync(profilePath, { recursive: true })
app.setPath('userData', profilePath)
app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const server = await createServer({ configFile: false, cacheDir: 'node_modules/.vite-content-search-test', optimizeDeps: { include: ['react', 'react-dom/client', 'lucide-react', '@tanstack/react-virtual'] }, resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': resolve('src/shared') } }, plugins: [react(), {
    name: 'content-search-test', configureServer(server) {
      server.middlewares.use('/__content_search_test', async (_req, response) => {
        const html = await server.transformIndexHtml('/__content_search_test', `<html><body><div id="root"></div><script type="module">
import { setLanguage } from '/src/shared/i18n/messages.ts'; setLanguage('zh-CN');
          import React, { useState } from 'react'; import { createRoot } from 'react-dom/client';
          import { ContentSearchResults } from '/src/renderer/src/features/search/ContentSearchResults.tsx';
          import '/src/renderer/src/styles/foundation.css'; import '/src/renderer/src/styles/theme.css'; import '/src/renderer/src/styles/search.css';
          const result = (i, long = false) => ({ path: '/website/server-' + i + '/start.sh', name: 'start.sh', type: 'file', size: 1600,
            matches: [{ lineNumber: 20, before: { lineNumber: 19, text: '# context' }, text: long ? 'needle ' + 'long snippet '.repeat(100) : '# === needle NEEDLE ===', after: { lineNumber: 21, text: 'mkdir -p uploads' } }] });
          function Fixture() { const [results, setResults] = useState([]); const [visible, setVisible] = useState(true);
            window.loadResults = count => setResults(Array.from({ length: count }, (_, i) => result(i, i % 3 === 1)));
            window.appendResults = () => setResults(items => [...items, result(items.length)]);
            window.setVisible = setVisible;
            return React.createElement('div', { id: 'panel', style: { display: visible ? 'flex' : 'none', flexDirection: 'column', width: 700, height: 500, margin: 20 } },
              React.createElement(ContentSearchResults, { results, query: 'needle', ignoreCase: true, running: false, status: 'completed', menu: null, onOpenMenu: (_event, result) => { window.clickedPath = result.path }, onScroll: () => {} })); }
          createRoot(document.getElementById('root')).render(React.createElement(Fixture));
        </script></body></html>`)
        response.setHeader('Content-Type', 'text/html')
        response.end(html)
      })
    }
  }], server: { host: '127.0.0.1', port: 0, watch: null } })
  const window = new BrowserWindow({ show: false, width: 1000, height: 600, webPreferences: { sandbox: true, backgroundThrottling: false } })
  window.webContents.on('console-message', details => { if (details.level === 'error') console.error(details.message) })
  try {
    await server.listen()
    await window.loadURL(server.resolvedUrls.local[0] + '__content_search_test')
    const metrics = await window.webContents.executeJavaScript(`(async () => {
      const tick = () => new Promise(resolve => setTimeout(resolve, 80));
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const waitFor = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw new Error('Timed out: ' + predicate); };
      await waitFor(() => window.loadResults);
      let viewport = document.querySelector('.content-search-results-list');
      const cards = () => [...document.querySelectorAll('.content-search-result')];
      const rows = () => [...document.querySelectorAll('.content-search-virtual-row')];
      const layoutSettled = () => rows().every((row, i, list) => i === 0 || row.getBoundingClientRect().top >= list[i-1].getBoundingClientRect().bottom - 1);
      const noOverlap = () => { const list = rows(); for (let i = 1; i < list.length; i++) check(list[i].getBoundingClientRect().top >= list[i-1].getBoundingClientRect().bottom - 1, 'Overlapping rows at ' + list[i].dataset.index + ': ' + JSON.stringify(list.map(row => ({ index: row.dataset.index, top: row.getBoundingClientRect().top, height: row.offsetHeight })))); };
      window.loadResults(8); await waitFor(() => cards().length === 8); viewport = document.querySelector('.content-search-results-list'); await tick();
      const shortHeight = cards()[0].offsetHeight, longHeight = cards()[1].offsetHeight;
      check(shortHeight < 160, 'Short result still has excess space: ' + shortHeight);
      check(longHeight > 213, 'Long result did not grow: ' + longHeight);
      check(cards()[0].querySelectorAll('mark').length === 2, 'Repeated case-insensitive matches missing');
      for (const card of cards()) { check(card.scrollHeight <= card.clientHeight + 1, 'Nested vertical scroll'); check(card.scrollWidth <= card.clientWidth + 1, 'Horizontal overflow'); }
      noOverlap();
      document.getElementById('panel').style.width = '380px'; await tick(); await tick();
      check(cards()[1].offsetHeight > longHeight, 'Wrapped snippet height not updated'); await waitFor(layoutSettled); noOverlap();
      document.getElementById('panel').style.width = '700px'; await tick(); await waitFor(layoutSettled); noOverlap();
      window.loadResults(10000); await tick(); await tick();
      const rendered = cards().length; check(rendered > 0 && rendered < 100, 'Unbounded DOM: ' + rendered);
      const reachBottom = async path => {
        for (let i = 0; i < 30; i++) {
          viewport.scrollTop = viewport.scrollHeight; await tick();
          const card = cards().find(card => card.querySelector('.search-result-path').textContent === path);
          if (card && card.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().bottom + 1) return card;
        }
        throw new Error('Cannot reach last result: ' + path);
      };
      const last = await reachBottom('/website/server-9999/start.sh'); await new Promise(resolve => setTimeout(resolve, 250)); noOverlap();
      last.click(); check(window.clickedPath === '/website/server-9999/start.sh', 'Wrong click target at bottom');
      window.appendResults(); await tick(); await reachBottom('/website/server-10000/start.sh'); await new Promise(resolve => setTimeout(resolve, 250)); noOverlap();
      window.setVisible(false); await tick(); window.setVisible(true); await tick(); await reachBottom('/website/server-10000/start.sh');
      window.loadResults(0); await tick(); viewport = document.querySelector('.content-search-results-list'); check(viewport.scrollTop === 0, 'Empty results did not reset scroll');
      window.loadResults(8); await waitFor(() => cards().length === 8); viewport = document.querySelector('.content-search-results-list'); await tick(); noOverlap();
      check(rows()[0].getBoundingClientRect().top >= viewport.getBoundingClientRect().top, 'New search starts offscreen');
      return { shortHeight, longHeight, rendered, total: 10000 };
    })()`)
    mkdirSync(resolve('data'), { recursive: true })
    for (const theme of ['light', 'dark']) {
      nativeTheme.themeSource = theme
      await window.loadURL(server.resolvedUrls.local[0] + '__content_search_test')
      await window.webContents.executeJavaScript(`(async () => {
        while (!window.loadResults) await new Promise(resolve => setTimeout(resolve, 50));
        window.loadResults(8);
        while (document.querySelectorAll('.content-search-result').length !== 8) await new Promise(resolve => setTimeout(resolve, 50));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      })()`)
      await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      window.webContents.invalidate()
      await new Promise(resolve => setTimeout(resolve, 500))
      await window.webContents.capturePage(undefined, { stayHidden: true })
      writeFileSync(resolve('data/audit-content-search-' + theme + '.png'), (await window.webContents.capturePage(undefined, { stayHidden: true })).toPNG())
    }
    console.log('content search browser checks passed ' + JSON.stringify(metrics))
  } finally { window.destroy(); await server.close() }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
