import { ipcMain as electronIpcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { getMainWindow } from '../runtime'
export function assertTrustedSender(event: IpcMainInvokeEvent, contents: WebContents | undefined): void {
  if (!contents || event.sender !== contents || !event.senderFrame
    || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== contents.getURL()) {
    throw new Error('拒绝来自非应用主界面的请求')
  }
}
export const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]): void {
    electronIpcMain.handle(channel, (event, ...args) => {
      assertTrustedSender(event, getMainWindow()?.webContents)
      return listener(event, ...args)
    })
  },
}
