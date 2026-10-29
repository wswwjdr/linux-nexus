import { ipcMain } from 'electron'
import { deleteCommandAlias, listCommandAliasSnapshots, saveCommandAlias, synchronizeCommandAliases } from '../command-aliases'

export function registerAliasesIpc(): void {
  ipcMain.handle('aliases:list', () => listCommandAliasSnapshots())
  ipcMain.handle('aliases:sync', (_event, profileId: string) => synchronizeCommandAliases(profileId))
  ipcMain.handle('aliases:save', (_event, profileId: string, name: string, command: string, existingCommand?: string) =>
    saveCommandAlias(profileId, name, command, existingCommand))
  ipcMain.handle('aliases:delete', (_event, profileId: string, name: string, expectedCommand: string) =>
    deleteCommandAlias(profileId, name, expectedCommand))
}
