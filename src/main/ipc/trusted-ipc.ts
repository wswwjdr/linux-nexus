import { type IpcResult, msg, LocalizedError, messageFromUnknown } from '../../shared/i18n/messages'
import { ipcMain as electronIpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getMainWindow } from '../runtime'
export function assertTrustedSender(event: IpcMainInvokeEvent, contents: WebContents | undefined): void {
  if (!contents || event.sender !== contents || !event.senderFrame
    || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== contents.getURL()) {
    throw new LocalizedError(msg('errors.requestRejectedSenderIsNotTheApplicationMainWindow'))
  }
}
export const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]): void {
    electronIpcMain.handle(channel, async (event, ...args): Promise<IpcResult<unknown>> => {
      try {
        assertTrustedSender(event, getMainWindow()?.webContents)
        return { ok: true, value: await listener(event, ...args) }
      } catch (error) {
        if (!(error instanceof LocalizedError)) console.error(`IPC ${channel} failed`, error)
        return { ok: false, error: messageFromUnknown(error) }
      }
    })
  },
}
