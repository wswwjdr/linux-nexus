import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { JSDOM } from 'jsdom'
import type { RemoteFilesApi } from '../src/shared/types'
import type { AssistantRequest, AssistantRequests, AssistantSnapshot } from '../src/shared/types/assistant'
import { AssistantMarkdown } from '../src/renderer/src/features/files/AssistantMarkdown'
import { AssistantPanel } from '../src/renderer/src/features/files/AssistantPanel'
import { AssistantSplit } from '../src/renderer/src/features/files/AssistantSplit'

test('assistant renders a streaming code fence and table without rendering remote images or unsafe links', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>', { url: 'http://localhost' })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!
  const root = createRoot(host)
  let copied = ''
  let opened = ''
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { copied = text } } })
  const onOpenExternalLink = (url: string) => { opened = url }
  const fenced = ['```bash', 'docker ps --all'].join('\n')
  const table = ['| Name | State |', '|---|---|', '| api | running |'].join('\n')
  try {
    await act(async () => root.render(createElement(AssistantMarkdown, { text: fenced, onOpenExternalLink })))
    assert.match(host.querySelector('pre code')!.textContent!, /docker ps --all/)
    const text = [fenced + '\n```', table, '![remote](https://example.com/tracker.png)',
      '[unsafe](javascript:alert%281%29) [docs](https://example.com/docs)', '<script>throw 1</script>'].join('\n\n')
    await act(async () => root.render(createElement(AssistantMarkdown, { text, onOpenExternalLink })))
    assert.equal(host.querySelector('table tbody td')?.textContent, 'api')
    assert.equal(host.querySelector('img, script, a[href^="javascript:"]'), null)
    await act(async () => host.querySelector<HTMLButtonElement>('.md-copy-code')!.click())
    assert.equal(copied, 'docker ps --all\n')
    act(() => host.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]')!.click())
    assert.equal(opened, 'https://example.com/docs')
  } finally { act(() => root.unmount()); dom.window.close() }
})

test('history button follows the sidebar and expanded tool failures display one error', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>', { url: 'http://localhost' })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  })
  const output = '模型提供的工具参数无效，工具未执行。'
  const snapshot: AssistantSnapshot = { sessionId: 'session', serverKey: 'server', identity: 'login',
    mode: 'manual', running: [], historyIssues: [], sequence: 0, conversations: [{ id: 'chat', updatedAt: 0, turns: [{
      id: 'turn', prompt: '检查端口', directory: '/project', providerId: 'provider', model: 'mock',
      text: '', mode: 'manual', status: 'done', approvals: [], questions: [], supplements: [], transcript: [], activity: [{ kind: 'tool', id: 'search' }],
      tools: [{ id: 'search', name: 'exec_command', path: '/project', status: 'failed', error: output }],
    }] }] }
  const responses: Partial<{ [Action in keyof AssistantRequests]: AssistantRequests[Action]['output'] }> = {
    snapshot,
    settings: {
      providers: [{ id: 'provider', name: 'Test', baseUrl: 'https://example.com', hasKey: false,
        defaultModel: 'mock', models: ['mock'] }],
      limits: { steps: 100, modelTimeoutSeconds: 120 },
    },
  }
  const remoteFiles = {
    /**
     * Handles assistant IPC calls made by the panel in this test.
     * @param request The request sent by the panel.
     * @returns The fixture response for the requested action.
     */
    async assistant<R extends AssistantRequest>(request: R): Promise<AssistantRequests[R['action']]['output']> {
      const action: R['action'] = request.action
      const response = responses[action]
      if (response === undefined) throw new Error(`Unexpected assistant request: ${action}`)
      return response
    },
    /**
     * Stubs event registration because the fixture emits no events.
     * @returns A no-op unsubscribe function.
     */
    onAssistantEvent: () => () => {},
  } satisfies Pick<RemoteFilesApi, 'assistant' | 'onAssistantEvent'>
  Object.defineProperty(dom.window, 'remoteFiles', { value: remoteFiles })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!
  const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(AssistantPanel, { sessionId: 'session', server: 'server',
      directory: '/project', fileIdentity: 'login', onClose: () => {}, onOpenExternalLink: () => {},
      controls: { side: 'right', expanded: false, narrow: false, swap: () => {}, expand: () => {} },
    })))
    const toggle = host.querySelector<HTMLButtonElement>('.assistant-header button[aria-expanded]')!
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    act(() => toggle.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    const history = host.querySelector('.assistant-history')!
    act(() => history.querySelector<HTMLButtonElement>('.icon-button')!.click())
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(host.querySelector('.assistant-history'), null)

    const tool = host.querySelector<HTMLDetailsElement>('.assistant-tool')!
    tool.open = true
    assert.equal(tool.textContent?.split(output).length, 2)
  } finally { act(() => root.unmount()); dom.window.close() }
})

test('split layout swaps sides, adjusts from keyboard, and restores files in a narrow window', async () => {
  const dom = new JSDOM('<body><div id="root"></div></body>', { url: 'http://localhost' })
  let width = 1200
  let notify!: (width: number) => void
  Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    localStorage: { configurable: true, value: dom.window.localStorage },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    ResizeObserver: { configurable: true, value: class {
      constructor(callback: (entries: Array<{ contentRect: { width: number } }>) => void) {
        notify = (size) => callback([{ contentRect: { width: size } }])
      }
      observe() {}
      disconnect() {}
    } },
  })
  const { createRoot } = await import('react-dom/client')
  const host = document.getElementById('root')!
  const root = createRoot(host)
  const file = createElement('div', { id: 'files' }, 'Files')
  try {
    await act(async () => root.render(createElement(AssistantSplit, { children: file,
      assistant: ({ swap }) => createElement('button', { onClick: swap }, 'Swap') })))
    const files = host.querySelector('#files')
    const divider = host.querySelector('[role="separator"]')!
    const initial = Number(divider.getAttribute('aria-valuenow'))
    act(() => divider.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
    assert.equal(Number(divider.getAttribute('aria-valuenow')), initial + 24)
    act(() => host.querySelector('button')!.click())
    assert.ok(host.querySelector('.assistant-split.assistant-left'))
    assert.equal(host.querySelector('#files'), files)
    act(() => { width = 790; notify(width) })
    assert.equal(host.querySelector('[role="separator"]'), null)
    assert.ok(host.querySelector('.assistant-file-pane[hidden]'))
    act(() => root.render(createElement(AssistantSplit, { children: file })))
    assert.equal(host.querySelector('.assistant-file-pane[hidden]'), null)
    assert.equal(host.querySelector('#files'), files)
  } finally { act(() => root.unmount()); dom.window.close() }
})
