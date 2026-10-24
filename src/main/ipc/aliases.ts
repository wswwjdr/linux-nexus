import { ipcMain } from 'electron'
import { deleteCommandAlias, listCommandAliasSnapshots, saveCommandAlias, synchronizeCommandAliases } from '../command-aliases'

export function registerAliasesIpc(): void {
  ipcMain.handle('aliases:list', () => listCommandAliasSnapshots())
  ipcMain.handle('aliases:sync', (_event, profileId: string) => synchronizeCommandAliases(profileId))
  ipcMain.handle('aliases:save', (_event, profileId: string, name: string, command: string, overwrite: boolean) =>
    saveCommandAlias(profileId, name, command, overwrite))
  ipcMain.handle('aliases:delete', (_event, profileId: string, name: string) => deleteCommandAlias(profileId, name))
}
