import assert from 'node:assert/strict'
import test from 'node:test'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { assertTrustedSender } from '../src/main/ipc/trusted-ipc.ts'

test('privileged IPC accepts the application main frame and rejects subframes and other windows', () => {
  const frame = { url: 'file:///app/index.html' }
  const contents = { mainFrame: frame, getURL: () => frame.url } as unknown as WebContents
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent
  assert.doesNotThrow(() => assertTrustedSender(event, contents))
  assert.throws(() => assertTrustedSender({ ...event, senderFrame: { url: frame.url } } as IpcMainInvokeEvent, contents))
  assert.throws(() => assertTrustedSender(event, {} as WebContents))
  assert.throws(() => assertTrustedSender(event, undefined))
})
