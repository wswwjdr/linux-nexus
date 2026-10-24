import { useEffect } from 'react'
import type { DialogLayerProps } from './dialogs/types'
import { ProfileDialogs } from './dialogs/ProfileDialogs'
import { DirectoryScriptDialogs } from './dialogs/DirectoryScriptDialogs'
import { SettingsDialog } from './dialogs/SettingsDialog'
import { SecurityDialogs } from './dialogs/SecurityDialogs'

export type { DialogLayerProps } from './dialogs/types'

export default function DialogLayer(props: DialogLayerProps) {
  const aliasHostKeyVisible = !props.pendingHostKey && Boolean(props.pendingAliasHostKey)

  useEffect(() => {
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return

      if (props.pendingHostKey || props.pendingAliasHostKey) {
        event.preventDefault()
        if (aliasHostKeyVisible) props.onDismissAliasHostKey()
        else props.onDismissHostKey()
        return
      }
      if (props.createDirectoryDialog) {
        event.preventDefault()
        if (!props.creatingDirectory) props.onCloseCreateDirectory()
        return
      }
      if (props.scriptCommandDialog) {
        event.preventDefault()
        props.onCloseScriptCommand()
        return
      }
      if (props.settingsForm) {
        event.preventDefault()
        if (!props.aliasOperationBusy) props.onCloseSettings()
        return
      }
      if (props.profileDialog) {
        event.preventDefault()
        props.onCloseProfile()
      }
    }

    window.addEventListener('keydown', dismissOnEscape)
    return () => window.removeEventListener('keydown', dismissOnEscape)
  }, [
    props.onCloseProfile,
    props.onCloseCreateDirectory,
    props.onCloseSettings,
    props.onDismissHostKey,
    props.onDismissAliasHostKey,
    props.onCloseScriptCommand,
    props.pendingHostKey,
    props.pendingAliasHostKey,
    props.createDirectoryDialog,
    props.creatingDirectory,
    props.scriptCommandDialog,
    props.settingsForm,
    props.aliasOperationBusy,
    props.profileDialog,
    aliasHostKeyVisible,
  ])

  return (
    <>
      <ProfileDialogs {...props} />
      <DirectoryScriptDialogs {...props} />
      <SettingsDialog {...props} />
      <SecurityDialogs {...props} />
    </>
  )
}
