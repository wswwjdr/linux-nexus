import { registerAliasesIpc } from './ipc/aliases'
import { registerFilesIpc } from './ipc/files'
import { registerHostKeysIpc } from './ipc/hostKeys'
import { registerProfilesIpc } from './ipc/profiles'
import { registerRemoteOperationsIpc } from './ipc/remoteOperations'
import { registerSessionsIpc } from './ipc/sessions'
import { registerSettingsIpc } from './ipc/settings'
import { registerAssistantIpc } from './ipc/assistant'

/** Registers all application IPC endpoints before the window starts. */
export function registerIpc(): void {
  registerAssistantIpc()
  registerProfilesIpc()
  registerSessionsIpc()
  registerSettingsIpc()
  registerAliasesIpc()
  registerHostKeysIpc()
  registerFilesIpc()
  registerRemoteOperationsIpc()
}
