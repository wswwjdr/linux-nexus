import { dialog, type BrowserWindow } from 'electron'
import { tr } from '../shared/i18n/messages'

/** Asks how to handle an observed local revision.
 * @param window Parent of the native Windows dialog.
 * @param destination Server and remote path shown to the user.
 * @param signal Closes the prompt if the application begins shutting down.
 * @returns The chosen policy for the observed revision.
 */
export async function askLocalEditUpload(window: BrowserWindow, destination: string, signal: AbortSignal): Promise<'once' | 'always' | 'skip'> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    message: tr('localEdit.confirmUpload'),
    detail: `${destination}\n\n${tr('localEdit.confirmUploadDetail')}`,
    buttons: [tr('localEdit.uploadOnce'), tr('localEdit.uploadAlways'), tr('localEdit.uploadNo')],
    defaultId: 2, cancelId: 2, noLink: true, signal,
  })
  return response === 0 ? 'once' : response === 1 ? 'always' : 'skip'
}
