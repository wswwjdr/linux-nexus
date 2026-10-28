import { ipcMain } from 'electron'
import { cancelCommandAliasPreflight, executeCommandAliasOperation, listCommandAliasSnapshots, preflightDeleteCommandAlias, saveCommandAlias, synchronizeCommandAliases } from '../command-aliases'

export function registerAliasesIpc(): void {
  ipcMain.handle('aliases:list', () => listCommandAliasSnapshots())
  ipcMain.handle('aliases:sync', (_event, profileId: string) => synchronizeCommandAliases(profileId))
  ipcMain.handle('aliases:save', (_event, profileId: string, name: string, command: string) =>
    saveCommandAlias(profileId, name, command))
  ipcMain.handle('aliases:delete-preflight', (_event, profileId: string, name: string, expectedCommand: string) =>
    preflightDeleteCommandAlias(profileId, name, expectedCommand))
  ipcMain.handle('aliases:execute', (_event, preflightId: string) => executeCommandAliasOperation(preflightId))
  ipcMain.handle('aliases:preflight-cancel', (_event, preflightId: string) => cancelCommandAliasPreflight(preflightId))
}
