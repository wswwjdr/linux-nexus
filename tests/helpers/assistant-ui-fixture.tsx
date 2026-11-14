import { createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage } from '../../src/shared/i18n/messages'
import { AssistantPanel } from '../../src/renderer/src/features/files/AssistantPanel'
import { AssistantSettings } from '../../src/renderer/src/components/dialogs/AssistantSettings'
import type { PromptEditorHandle } from '../../src/renderer/src/components/dialogs/AssistantPromptEditor'
import type { AssistantEvent, AssistantEventChange, AssistantSnapshot, AssistantTurn } from '../../src/shared/types/assistant'

const profiles = [
  { id: 'one', name: 'One', host: 'one.local', port: 22, username: 'user', pinned: false },
  { id: 'two', name: 'Two', host: 'two.local', port: 22, username: 'user', pinned: false },
]
const longChatTitle = 'A long conversation title that should stay on one line and truncate before the actions button'
const snapshot: AssistantSnapshot = { sessionId: 'owner', serverKey: 'server', identity: 'login', mode: 'manual',
  sequence: 0, historyIssues: ['Invalid record'], running: [{ sessionId: 'owner', conversationId: 'live', taskId: 'task' }],
  conversations: [
    { id: 'selected', title: 'Current chat', updatedAt: 100, turns: [] },
    { id: 'other', title: 'Other chat', updatedAt: 99, turns: [] },
    { id: 'live', title: 'Active chat', updatedAt: 98, turns: [] },
    { id: 'long', title: longChatTitle, updatedAt: 97, turns: [] },
  ],
}
const events = new Set<(event: AssistantEvent) => void>()
const overrides = new Map<string, string | null>()
let language: 'en' | 'zh-CN' = 'en'

/** Dispatches a history event to all mounted fixture panels with the next sequence number. */
function dispatch(event: AssistantEventChange extends infer Change
  ? Change extends AssistantEventChange ? Omit<Change, 'serverKey'> : never : never): void {
  for (const listener of events) listener({ ...event, serverKey: snapshot.serverKey, sequence: snapshot.sequence })
}

window.remoteFiles = {
  onAssistantEvent(listener: (event: AssistantEvent) => void) {
    events.add(listener)
    return () => events.delete(listener)
  },
  async assistant({ action, input }) {
    switch (action) {
      case 'settings': return { providers: [], limits: { steps: 100, modelTimeoutSeconds: 120 } }
      case 'snapshot': {
        if (input.refresh) snapshot.historyIssues = []
        // Leave the active task with the other tab so the fixture starts on Current chat.
        return structuredClone({ ...snapshot, sessionId: input.sessionId })
      }
      case 'renameConversation':
        snapshot.conversations.find((chat) => chat.id === input.conversationId)!.title = input.title
        snapshot.sequence++
        dispatch({ kind: 'rename', conversationId: input.conversationId, title: input.title })
        return
      case 'deleteConversation':
        snapshot.conversations = snapshot.conversations.filter((chat) => chat.id !== input.conversationId)
        snapshot.sequence++
        dispatch({ kind: 'delete', conversationId: input.conversationId })
        return
      case 'savePrompt':
        overrides.set(input.profileId ?? 'global', input.prompt)
        // A save returns the resolved prompt for the same scope.
      case 'promptSettings':
        return { defaultPrompt: language === 'en' ? 'English default' : '中文默认',
          globalPrompt: overrides.get('global') ?? null, serverPrompt: overrides.get(input.profileId ?? '') ?? null }
      default: throw new Error('Unexpected request: ' + action)
    }
  },
} as typeof window.remoteFiles

/** Returns the first matching element, failing with the selector if the expected control is absent. */
function find<T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = document): T {
  const node = scope.querySelector<T>(selector)
  if (!node) throw new Error('Missing ' + selector)
  return node
}

/** Waits for React and the browser to commit an interaction before inspecting the DOM. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 75))
}

/** Sends a native input event for a controlled React input or textarea. */
function typeText(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Runs history operations and prompt settings through actual Chromium controls. */
async function verify(): Promise<void> {
  const root = createRoot(document.body.appendChild(document.createElement('div')))
  const controls = { side: 'right' as const, expanded: false, narrow: false, swap() {}, expand() {} }
  root.render(<>{['observer', 'second'].map((sessionId, index) => <div className="assistant-pane"
    key={sessionId} style={{ width: index ? 520 : 880 }}><AssistantPanel sessionId={sessionId} server="test"
      directory="/project" selectedPaths={[]} fileIdentity="login" controls={controls} onClose={() => {}}
      onOpenExternalLink={() => {}} /></div>)}</>)
  await tick()
  const [wide, narrow] = document.querySelectorAll('.assistant-panel')
  find('button[aria-expanded]', wide).click()
  find('button[aria-expanded]', narrow).click()
  await tick()
  if (find('button[aria-current]', wide).title !== 'Current chat') throw new Error('Initial selection')
  for (const panel of [wide, narrow]) {
    const title = find('.assistant-history-title', find(`button[title="${longChatTitle}"]`, panel))
    const active = find('button[title="Active chat"]', panel)
    const activeTitle = find('.assistant-history-title', active)
    const meta = find('.assistant-history-meta', active)
    if (title.scrollWidth <= title.clientWidth || getComputedStyle(title).textOverflow !== 'ellipsis') {
      throw new Error('Long conversation titles must truncate within their own column')
    }
    if (activeTitle.getBoundingClientRect().bottom >= meta.getBoundingClientRect().top
      || meta.getBoundingClientRect().bottom >= active.getBoundingClientRect().bottom) {
      throw new Error('Activity metadata overlaps the title or spills outside its row')
    }
  }
  find('.assistant-history-issue button', wide).click()
  await tick()
  if (wide.querySelector('.assistant-history-issue')) throw new Error('Retry did not clear the warning')
  const activeMore = find('button[aria-label="Actions for Active chat"]', wide)
  const activeBounds = activeMore.getBoundingClientRect()
  const nextRow = find(`button[title="${longChatTitle}"]`, wide)
  const nextTop = nextRow.getBoundingClientRect().top
  activeMore.click()
  await tick()
  const activeMenu = find('.assistant-history-menu:popover-open', wide)
  if (!find<HTMLButtonElement>('button:last-child', activeMenu).disabled) throw new Error('Active delete enabled')
  const menuBounds = activeMenu.getBoundingClientRect()
  if (menuBounds.right < activeBounds.left || menuBounds.left > activeBounds.right
    || nextRow.getBoundingClientRect().top !== nextTop) throw new Error('Actions are detached or move conversation rows')
  find('button[aria-label="Actions for Other chat"]', wide).click()
  await tick()
  find('.assistant-history-menu:popover-open button', wide).click()
  await tick()
  const rename = find<HTMLInputElement>('.assistant-rename input', wide)
  typeText(rename, '  Renamed chat  ')
  await tick()
  find('.assistant-rename button', wide).click()
  await tick()
  find('button[title="Renamed chat"]', narrow)
  if (find('button[aria-current]', wide).title !== 'Current chat') throw new Error('Rename changed selection')
  find('button[title="Renamed chat"]', narrow).click()
  await tick()
  if (narrow.querySelector('.assistant-history')) throw new Error('Narrow history did not close')
  find('button[aria-label="Actions for Other chat"], button[aria-label="Actions for Renamed chat"]', wide).click()
  await tick()
  find('.assistant-history-menu:popover-open button:last-child', wide).click()
  await tick()
  const confirm = find<HTMLDialogElement>('dialog:modal', wide)
  if (!confirm.textContent?.includes('Renamed chat')) throw new Error('Confirmation missing title')
  find('button:last-child', confirm).click()
  await tick()
  if (wide.querySelector('button[title="Renamed chat"]')) throw new Error('Deleted chat remains')
  if (find('.assistant-heading strong', narrow).textContent !== 'Current chat') throw new Error('Selected deletion did not fall back')

  const ref = createRef<PromptEditorHandle>()
  root.render(<AssistantSettings profiles={profiles} navigationRef={ref} />)
  await tick()
  const [global, server] = document.querySelectorAll('.assistant-prompt-settings')
  const globalText = find<HTMLTextAreaElement>('textarea', global)
  const serverText = find<HTMLTextAreaElement>('textarea', server)
  if (!serverText.readOnly || serverText.value !== 'English default') throw new Error('Inherited server prompt')
  const mode = find<HTMLSelectElement>('label:nth-of-type(2) select', server)
  mode.value = 'custom'
  mode.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
  typeText(serverText, 'Custom for One')
  await tick()
  const select = find<HTMLSelectElement>('select', server)
  select.value = 'two'
  select.dispatchEvent(new Event('change', { bubbles: true }))
  await tick()
  find('dialog:modal .primary-button', server).click()
  await tick()
  if (select.value !== 'two' || overrides.get('one') !== 'Custom for One' || String(serverText.value) !== 'English default') {
    throw new Error('Profile switch did not save in the originating scope')
  }
  typeText(globalText, 'Unsaved text')
  await tick()
  let left = false
  ref.current?.leave(() => { left = true })
  await tick()
  find('dialog:modal button:last-child', global).click()
  await tick()
  if (left || globalText.value !== 'Unsaved text') throw new Error('Cancel lost the unsaved prompt')
  ref.current?.leave(() => { left = true })
  await tick()
  find('dialog:modal button:nth-child(2)', global).click()
  await tick()
  if (!left) throw new Error('Discard did not continue navigation')
  language = 'zh-CN'
  setLanguage(language)
  await tick()
  if (String(globalText.value) !== '中文默认' || String(serverText.value) !== '中文默认') throw new Error('Language was not applied')
  root.unmount()
}

const scrollTurn: AssistantTurn = {
  id: 'scroll-1', status: 'done', prompt: 'First question', text: '', providerId: 'provider', model: 'mock',
  mode: 'manual', directory: '/', approvals: [], questions: [], supplements: [], tools: [], transcript: [], activity: [],
}
const liveTurn: AssistantTurn = { ...scrollTurn, id: 'scroll-2', status: 'running', prompt: 'Follow-up question' }

/** Appends paragraphs through the same event subscription used by live model updates. */
async function growAssistantScroll(): Promise<void> {
  liveTurn.text += '\n\n' + 'Additional streamed paragraphs.\n\n'.repeat(6)
  const turn: AssistantTurn = { ...liveTurn, activity: [{ kind: 'text', text: liveTurn.text }] }
  snapshot.sequence++
  dispatch({ kind: 'turn', sessionId: 'observer', conversationId: 'selected', taskId: turn.id, updatedAt: Date.now(), turn })
  await tick()
}

/** Mounts an overflowing second turn and reports the scrollbar geometry to the Electron test driver. */
async function prepareAssistantScroll() {
  const chat = snapshot.conversations.find(({ id }) => id === 'selected')!
  chat.turns = [scrollTurn, liveTurn]
  snapshot.historyIssues = []
  const host = document.body.appendChild(document.createElement('div'))
  host.style.height = '450px'
  host.style.display = 'flex'
  const root = createRoot(host)
  root.render(<AssistantPanel sessionId="observer" server="test" directory="/" selectedPaths={[]} fileIdentity="login"
    controls={{ side: 'right', expanded: false, narrow: false, swap() {}, expand() {} }} onClose={() => {}}
    onOpenExternalLink={() => {}} />)
  await tick()
  await growAssistantScroll()
  await growAssistantScroll()
  await growAssistantScroll()
  const view = find<HTMLElement>('.assistant-transcript')
  const rect = view.getBoundingClientRect()
  const bubble = find('.assistant-turn + .assistant-turn .assistant-user-message')
  const reply = find('.assistant-turn + .assistant-turn .assistant-markdown')
  if (getComputedStyle(bubble).paddingLeft === '0px' || getComputedStyle(reply).paddingLeft !== '0px') {
    throw new Error('Question and reply spacing regressed')
  }
  if (document.querySelector('.assistant-latest')) throw new Error('Removed jump button still present')
  return { x: rect.x, y: rect.y, width: rect.width, height: view.clientHeight, clientWidth: view.clientWidth,
    contentHeight: view.scrollHeight, top: view.scrollTop }
}

/** Reports the current native scroll offset and bottom boundary. */
function readAssistantScroll() {
  const view = find<HTMLElement>('.assistant-transcript')
  return { top: view.scrollTop, end: view.scrollHeight - view.clientHeight }
}

Object.assign(window, { verifyAssistantUI: verify, prepareAssistantScroll, growAssistantScroll, readAssistantScroll })
